import crypto from "crypto";
import {
  ActivityEntry,
  Post,
} from "./types";
import {
  addActivity,
  getPosts,
  getSessionRecord,
  getPost,
  savePost,
  touchHeartbeat,
} from "./data";
import { getFreshAccessToken, setNeedsReconnect, syncRefs } from "./session";
import { submitPost } from "./submit";
import { MIN } from "./time";

// Cron worker — runs on each 5-minute ping to /api/cron/tick.
//
// 1. Opportunistically refresh the reference-data cache (daily is enough).
// 2. Find due posts and fire them: refresh token if within the 10-minute
//    expiry buffer → submit via Prompted's PostgREST API → log the attempt.
// 3. Failures retry with backoff (5 min, then 10 min), max 3 attempts before
//    "failed". Auth failures flag the account as needing reconnection.
// 4. Idempotency: a post is only ever picked up while its status is "queued"
//    (plus a stale-lock recovery path), so overlapping cron runs can't
//    double-fire.

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MIN = 10;
const MAX_PER_RUN = 5;

export interface TickSummary {
  ranAt: string;
  due: number;
  posted: number;
  retrying: number;
  failed: number;
  skipped: number;
  refsSynced: boolean;
  errors: string[];
}

function log(entry: Omit<ActivityEntry, "id" | "at">) {
  return addActivity({
    ...entry,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  });
}

function backoffMs(attempts: number): number {
  // Cron granularity is 5 minutes: attempt 1 → +5 min, attempt 2 → +10 min.
  return attempts * 5 * MIN;
}

function isDue(post: Post, now: number): boolean {
  if (post.status === "queued") {
    const fireAt = new Date(post.fireAt).getTime();
    const retryOk =
      !post.nextRetryAt || new Date(post.nextRetryAt).getTime() <= now;
    return fireAt <= now && retryOk;
  }
  // Recover posts stuck in_progress by a crashed/overlapped run.
  if (post.status === "in_progress" && post.lockedAt) {
    return now - new Date(post.lockedAt).getTime() > STALE_LOCK_MIN * MIN;
  }
  return false;
}

async function failAttempt(
  post: Post,
  reason: string,
  authFailure: boolean,
): Promise<"retrying" | "failed"> {
  const attempts = post.attempts + 1;
  const title = post.title || `(${post.type} post)`;
  if (attempts >= MAX_ATTEMPTS) {
    await savePost({
      ...post,
      status: "failed",
      attempts,
      lastError: reason,
      nextRetryAt: null,
      lockedAt: null,
    });
    if (authFailure) await setNeedsReconnect(true);
    await log({
      postId: post.id,
      postType: post.type,
      title,
      status: "failed",
      attempts,
      reason,
      authFailure,
    });
    return "failed";
  }
  const nextRetryAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
  await savePost({
    ...post,
    status: "queued",
    attempts,
    lastError: reason,
    nextRetryAt,
    lockedAt: null,
  });
  await log({
    postId: post.id,
    postType: post.type,
    title,
    status: "retrying",
    attempts,
    reason,
    authFailure,
  });
  return "retrying";
}

export async function runTick(): Promise<TickSummary> {
  const now = Date.now();
  // Heartbeat first: even a no-op tick proves cron-job.org is reaching us.
  // If this timestamp ever goes stale, the UI raises the alarm.
  try {
    await touchHeartbeat();
  } catch {
    // never block posting on the heartbeat write
  }
  const summary: TickSummary = {
    ranAt: new Date().toISOString(),
    due: 0,
    posted: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    refsSynced: false,
    errors: [],
  };

  // Daily reference sync, piggybacked on the cron — never blocks posting.
  try {
    const refs = await syncRefs();
    summary.refsSynced = refs.synced;
    if (refs.error && refs.error !== "not connected") {
      summary.errors.push(`refs: ${refs.error}`);
    }
  } catch (e) {
    summary.errors.push(`refs: ${e instanceof Error ? e.message : "unknown"}`);
  }

  const allPosts = await getPosts();
  const due = allPosts
    .filter((p) => isDue(p, now))
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1))
    .slice(0, MAX_PER_RUN);
  summary.due = due.length;

  for (const candidate of due) {
    // Idempotency gate: re-read the post; only fire if still queued (or a
    // stale in_progress lock). An overlapping run that already grabbed it
    // leaves status "in_progress" with a fresh lock, so we skip.
    const post = await getPost(candidate.id);
    if (!post || !isDue(post, Date.now())) {
      summary.skipped++;
      continue;
    }

    // Claim the post.
    await savePost({
      ...post,
      status: "in_progress",
      lockedAt: new Date().toISOString(),
    });

    // Auth precheck — token-mode connections with a stale flag hold posts
    // until reconnected; password-mode connections are allowed through so
    // getFreshAccessToken can self-heal by re-signing in.
    const record = await getSessionRecord();
    if (!record || (record.needsReconnect && !record.passwordEnc)) {
      await savePost({ ...post, status: "queued", lockedAt: null });
      summary.skipped++;
      summary.errors.push("no connected session — posts held until reconnect");
      continue;
    }

    const token = await getFreshAccessToken();
    if (!token.ok || !token.accessToken) {
      const outcome = await failAttempt(post, token.error ?? "auth", true);
      summary[outcome]++;
      continue;
    }

    try {
      const result = await submitPost(post, record.user.id, token.accessToken);
      if (result.ok) {
        await savePost({
          ...post,
          status: "posted",
          postedAt: new Date().toISOString(),
          attempts: post.attempts + 1,
          lastError: null,
          nextRetryAt: null,
          lockedAt: null,
          promptedPostId: result.postId ?? null,
        });
        await log({
          postId: post.id,
          postType: post.type,
          title: post.title || `(${post.type} post)`,
          status: "posted",
          attempts: post.attempts + 1,
        });
        summary.posted++;
      } else {
        const outcome = await failAttempt(
          post,
          result.error ?? "unknown error",
          Boolean(result.authFailed),
        );
        summary[outcome]++;
      }
    } catch (e) {
      const outcome = await failAttempt(
        post,
        e instanceof Error ? e.message : "network error",
        false,
      );
      summary[outcome]++;
    }
  }

  return summary;
}
