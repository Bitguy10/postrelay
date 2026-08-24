import crypto from "crypto";
import { ActivityEntry, Post, UserRecord } from "./types";
import {
  addActivity,
  getAllUserIds,
  getPosts,
  getPost,
  getPasswordEnc,
  getUserRecord,
  savePost,
  touchHeartbeat,
} from "./data";
import { getFreshAccessToken, setNeedsReconnect, syncRefs } from "./session";
import { submitPost } from "./submit";
import { MIN } from "./time";

// Cron worker — runs on each 5-minute ping to /api/cron/tick.
//
// 1. Heartbeat + opportunistic global reference-data refresh (daily).
// 2. For EVERY connected account: find that account's due posts and fire
//    them (refresh/heal its token first, submit via Prompted's PostgREST
//    API, log every attempt). Each account's queue is fully isolated.
// 3. Failures retry with backoff (5 min, then 10 min), max 3 attempts.
// 4. Idempotency: a post is only picked up while "queued" (plus stale-lock
//    recovery), so overlapping cron runs can't double-fire.

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MIN = 10;
const MAX_PER_USER = 5;

export interface TickSummary {
  ranAt: string;
  accounts: number;
  due: number;
  posted: number;
  retrying: number;
  failed: number;
  skipped: number;
  refsSynced: boolean;
  errors: string[];
}

function log(userId: string, entry: Omit<ActivityEntry, "id" | "at">) {
  return addActivity(userId, {
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
  if (post.status === "in_progress" && post.lockedAt) {
    return now - new Date(post.lockedAt).getTime() > STALE_LOCK_MIN * MIN;
  }
  return false;
}

async function failAttempt(
  userId: string,
  post: Post,
  reason: string,
  authFailure: boolean,
): Promise<"retrying" | "failed"> {
  const attempts = post.attempts + 1;
  const title = post.title || `(${post.type} post)`;
  if (attempts >= MAX_ATTEMPTS) {
    await savePost(userId, {
      ...post,
      status: "failed",
      attempts,
      lastError: reason,
      nextRetryAt: null,
      lockedAt: null,
    });
    if (authFailure) await setNeedsReconnect(userId, true);
    await log(userId, {
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
  await savePost(userId, {
    ...post,
    status: "queued",
    attempts,
    lastError: reason,
    nextRetryAt,
    lockedAt: null,
  });
  await log(userId, {
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

async function runForUser(user: UserRecord, summary: TickSummary): Promise<void> {
  const uid = user.id;
  const posts = await getPosts(uid);
  const due = posts
    .filter((p) => isDue(p, Date.now()))
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1))
    .slice(0, MAX_PER_USER);
  summary.due += due.length;

  for (const candidate of due) {
    // Idempotency gate: re-read; only fire if still queued (or stale-locked).
    const post = await getPost(uid, candidate.id);
    if (!post || !isDue(post, Date.now())) {
      summary.skipped++;
      continue;
    }

    // Claim the post.
    await savePost(uid, {
      ...post,
      status: "in_progress",
      lockedAt: new Date().toISOString(),
    });

    // Auth precheck — token-mode accounts with a stale flag hold posts;
    // password-mode accounts pass through so getFreshAccessToken can heal.
    const pwdEnc = await getPasswordEnc(uid);
    if (!pwdEnc && user.needsReconnect) {
      await savePost(uid, { ...post, status: "queued", lockedAt: null });
      summary.skipped++;
      summary.errors.push(`${user.username}: session stale — held until reconnect`);
      continue;
    }

    const token = await getFreshAccessToken(uid);
    if (!token.ok || !token.accessToken) {
      const outcome = await failAttempt(uid, post, token.error ?? "auth", true);
      summary[outcome]++;
      continue;
    }

    try {
      const result = await submitPost(post, uid, token.accessToken);
      if (result.ok) {
        await savePost(uid, {
          ...post,
          status: "posted",
          postedAt: new Date().toISOString(),
          attempts: post.attempts + 1,
          lastError: null,
          nextRetryAt: null,
          lockedAt: null,
          promptedPostId: result.postId ?? null,
        });
        await log(uid, {
          postId: post.id,
          postType: post.type,
          title: post.title || `(${post.type} post)`,
          status: "posted",
          attempts: post.attempts + 1,
        });
        summary.posted++;
      } else {
        const outcome = await failAttempt(
          uid,
          post,
          result.error ?? "unknown error",
          Boolean(result.authFailed),
        );
        summary[outcome]++;
      }
    } catch (e) {
      const outcome = await failAttempt(
        uid,
        post,
        e instanceof Error ? e.message : "network error",
        false,
      );
      summary[outcome]++;
    }
  }
}

export async function runTick(): Promise<TickSummary> {
  // Heartbeat first: even a no-op tick proves cron-job.org is reaching us.
  try {
    await touchHeartbeat();
  } catch {
    // never block posting on the heartbeat write
  }
  const summary: TickSummary = {
    ranAt: new Date().toISOString(),
    accounts: 0,
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

  // Fan out over every connected account — each queue is isolated.
  for (const uid of await getAllUserIds()) {
    const user = await getUserRecord(uid);
    if (!user) continue;
    const enc = await getPasswordEnc(uid);
    if (!enc && user.needsReconnect) continue; // stale token account, nothing to do
    summary.accounts++;
    try {
      await runForUser(user, summary);
    } catch (e) {
      summary.errors.push(
        `${user.username}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  return summary;
}
