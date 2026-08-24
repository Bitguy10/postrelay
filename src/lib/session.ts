import { DateTime } from "luxon";
import { decryptJSON, encryptJSON } from "./crypto";
import {
  getBatches,
  getPosts,
  getRefs,
  getSessionRecord,
  saveBatch,
  savePost,
  saveSessionRecord,
  saveRefs,
} from "./data";
import {
  extractUser,
  refreshSession,
  signInWithPassword,
  verifyToken,
} from "./prompted";
import { PromptedSession, SessionRecord } from "./types";
import { isValidZone, MIN } from "./time";

// Session lifecycle: connect (verify + encrypt), automatic refresh with a
// 10-minute expiry buffer, and the reconnect flag surfaced in the UI.

const REFRESH_BUFFER_MIN = 10;

/** Sanitize a provided timezone: valid IANA → keep; anything else → UTC + flag. */
function safeZone(zone: string | undefined): { timezone: string; tzFallback: boolean } {
  if (isValidZone(zone)) return { timezone: zone!, tzFallback: false };
  return { timezone: "UTC", tzFallback: true };
}

export async function connectSession(
  pasted: PromptedSession,
  timezone?: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const verification = await verifyToken(pasted.access_token);
  if (!verification.ok) {
    return { ok: false, error: `Prompted rejected this token: ${verification.error}` };
  }
  const tz = safeZone(timezone);
  const rec: SessionRecord = {
    enc: encryptJSON(pasted),
    user: verification.user,
    ...tz,
    needsReconnect: false,
    connectedAt: new Date().toISOString(),
    authMode: "token",
  };
  await saveSessionRecord(rec);
  return { ok: true, username: verification.user.username ?? "you" };
}

/**
 * Connect by signing in directly with email + password. This mints an
 * INDEPENDENT Supabase session (its own refresh-token family) that the
 * user's open prmpted.com tab can never invalidate — and stores the
 * password encrypted so PostRelay can re-sign-in itself if the session is
 * ever lost. The password is never returned by any API after this.
 */
export async function connectWithPassword(
  email: string,
  password: string,
  timezone?: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  if (!email || !password) {
    return { ok: false, error: "Email and password are required" };
  }
  const signedIn = await signInWithPassword(email.trim(), password);
  if (!signedIn.ok) return { ok: false, error: signedIn.error };
  const tz = safeZone(timezone);
  const rec: SessionRecord = {
    enc: encryptJSON(signedIn.session),
    user: extractUser(signedIn.session.user),
    ...tz,
    needsReconnect: false,
    connectedAt: new Date().toISOString(),
    passwordEnc: encryptJSON(password),
    authMode: "password",
  };
  await saveSessionRecord(rec);
  return { ok: true, username: rec.user.username ?? "you" };
}

export interface TimezoneChange {
  ok: boolean;
  timezone?: string;
  tzFallback?: boolean;
  shiftedPosts?: number;
  shiftedBatches?: number;
  error?: string;
}

/**
 * Change the stored timezone. If the user chose to reinterpret existing
 * not-yet-fired posts, each fire time's WALL CLOCK in the old zone is
 * re-anchored at the same wall time in the new zone (a post set for 9:00am
 * stays 9:00am — the absolute moment changes). With "keep", posts keep their
 * absolute UTC instants and existing batch rules stay in their old zone.
 */
export async function changeTimezone(
  newZone: string | undefined,
  reinterpret: "shift" | "keep" | undefined,
): Promise<TimezoneChange> {
  const rec = await getSessionRecord();
  if (!rec) return { ok: false, error: "No connected account" };
  const tz = safeZone(newZone);
  if (tz.timezone === rec.timezone) {
    await saveSessionRecord({ ...rec, timezone: tz.timezone, tzFallback: tz.tzFallback });
    return { ok: true, timezone: tz.timezone, tzFallback: tz.tzFallback, shiftedPosts: 0, shiftedBatches: 0 };
  }
  const oldZone = isValidZone(rec.timezone) ? rec.timezone : "UTC";

  let shiftedPosts = 0;
  let shiftedBatches = 0;
  if (reinterpret === "shift") {
    const posts = await getPosts();
    for (const p of posts) {
      if (p.status === "queued" || p.status === "in_progress" || p.status === "draft") {
        const shifted = DateTime.fromISO(p.fireAt)
          .setZone(oldZone)
          .setZone(tz.timezone, { keepLocalTime: true })
          .toUTC()
          .toISO()!;
        await savePost({ ...p, fireAt: shifted });
        shiftedPosts++;
      }
    }
    const batches = await getBatches();
    for (const b of batches) {
      await saveBatch({ ...b, timezone: tz.timezone });
      shiftedBatches++;
    }
  }

  await saveSessionRecord({
    ...rec,
    timezone: tz.timezone,
    tzFallback: tz.tzFallback,
  });
  return { ok: true, ...tz, shiftedPosts, shiftedBatches };
}

export async function setNeedsReconnect(v: boolean): Promise<void> {
  const rec = await getSessionRecord();
  if (rec) {
    rec.needsReconnect = v;
    await saveSessionRecord(rec);
  }
}

export interface TokenResult {
  ok: boolean;
  accessToken?: string;
  error?: string;
}

/**
 * Return a definitely-fresh access token, refreshing via Prompted's Supabase
 * refresh endpoint when expiry is within the buffer. Supabase rotates the
 * refresh token on every call, so both tokens are re-encrypted and persisted.
 */
export async function getFreshAccessToken(): Promise<TokenResult> {
  const rec = await getSessionRecord();
  if (!rec) return { ok: false, error: "No connected Prompted account" };
  // Token-mode connections that went stale need a manual re-paste.
  // Password-mode connections self-heal below instead.
  if (rec.needsReconnect && !rec.passwordEnc) {
    return { ok: false, error: "Session stale — reconnect required" };
  }

  let session: PromptedSession;
  try {
    session = decryptJSON<PromptedSession>(rec.enc);
  } catch {
    return { ok: false, error: "Stored session could not be decrypted" };
  }

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const needsRefresh =
    !expiresAtMs || expiresAtMs - Date.now() < REFRESH_BUFFER_MIN * MIN;
  // A stale password-mode record heals proactively even if the token still
  // looks valid — clears the reconnect flag on the next cron touch.
  const mustHeal = rec.needsReconnect && Boolean(rec.passwordEnc);

  if (needsRefresh || mustHeal) {
    if (needsRefresh) {
      const refreshed = await refreshSession(session.refresh_token);
      if (refreshed.ok) {
        session = refreshed.session;
      } else if (!rec.passwordEnc) {
        await setNeedsReconnect(true);
        return { ok: false, error: refreshed.error };
      } else {
        // Self-healing: mint a brand-new independent session instead of
        // failing (covers rotation conflicts, forced logouts, stale flags).
        let password: string;
        try {
          password = decryptJSON<string>(rec.passwordEnc);
        } catch {
          await setNeedsReconnect(true);
          return { ok: false, error: "Stored credentials could not be decrypted" };
        }
        const signedIn = await signInWithPassword(
          rec.user.email ?? "",
          password,
        );
        if (!signedIn.ok) {
          await setNeedsReconnect(true);
          return {
            ok: false,
            error: `Sign-in failed (${signedIn.error}) — password changed?`,
          };
        }
        session = signedIn.session;
      }
    }
    // Persist whichever session we now have (rotating BOTH tokens — Supabase
    // invalidates the previous refresh token on each issue).
    rec.enc = encryptJSON(session);
    rec.refreshedAt = new Date().toISOString();
    rec.needsReconnect = false;
    await saveSessionRecord(rec);
    return { ok: true, accessToken: session.access_token };
  }

  return { ok: true, accessToken: session.access_token };
}

/** Daily reference-data sync (categories / ai_tools / communities) into Redis. */
export async function syncRefs(
  force = false,
): Promise<{ synced: boolean; error?: string }> {
  const existing = await getRefs();
  const staleAfter = 20 * 60 * MIN; // 20h — daily is the goal, cron drift tolerated
  if (!force && existing?.syncedAt) {
    if (Date.now() - new Date(existing.syncedAt).getTime() < staleAfter) {
      return { synced: false };
    }
  }
  // Primary path: the connected user's (fresh) token, per Prompted's own calls.
  // Fallback: the tables are anon-readable, so sync never silently stops when
  // there's no session or the session needs reconnection.
  let token: string | undefined;
  const rec = await getSessionRecord();
  if (rec) {
    const t = await getFreshAccessToken();
    token = t.ok ? t.accessToken : undefined;
  }
  try {
    const refs = await (await import("./prompted")).fetchRefs(token);
    await saveRefs(refs);
    return { synced: true };
  } catch (e) {
    return { synced: false, error: e instanceof Error ? e.message : "sync failed" };
  }
}
