import { DateTime } from "luxon";
import { decryptJSON, encryptJSON } from "./crypto";
import {
  bindDevice,
  getBatches,
  getPasswordEnc,
  getPosts,
  getRefs,
  getSessionEnc,
  getUserRecord,
  saveBatch,
  savePost,
  saveRefs,
  saveUserRecord,
  setSessionEnc,
  setPasswordEnc,
} from "./data";
import {
  extractUser,
  refreshSession,
  signInWithPassword,
  verifyToken,
} from "./prompted";
import { PromptedSession, UserRecord } from "./types";
import { isValidZone, MIN } from "./time";

// Session lifecycle, per account. Connect (verify/sign-in → encrypt → bind
// this browser to the account), automatic refresh with a 10-minute expiry
// buffer, and self-healing re-sign-in for password-mode accounts.

const REFRESH_BUFFER_MIN = 10;

/** Sanitize a provided timezone: valid IANA → keep; anything else → UTC + flag. */
function safeZone(zone: string | undefined): { timezone: string; tzFallback: boolean } {
  if (isValidZone(zone)) return { timezone: zone!, tzFallback: false };
  return { timezone: "UTC", tzFallback: true };
}

/** Upsert the account record + store the encrypted session; bind the device. */
async function persistConnection(
  session: PromptedSession,
  username: string,
  email: string | undefined,
  timezone: string | undefined,
  deviceId: string,
  passwordEnc?: string,
): Promise<string> {
  const uid = session.user.id;
  const existing = await getUserRecord(uid);
  const tz = safeZone(timezone ?? existing?.timezone);
  const rec: UserRecord = {
    id: uid,
    username: username || existing?.username || "you",
    email: email ?? existing?.email,
    ...tz,
    needsReconnect: false,
    connectedAt: existing?.connectedAt ?? new Date().toISOString(),
    refreshedAt: new Date().toISOString(),
    authMode: passwordEnc ? "password" : "token",
  };
  await saveUserRecord(rec);
  await setSessionEnc(uid, encryptJSON(session));
  if (passwordEnc !== undefined) {
    await setPasswordEnc(uid, passwordEnc);
  } else if (existing?.authMode === "password") {
    // keep previously stored credentials when re-connecting via token
  }
  if (deviceId) await bindDevice(deviceId, uid);
  return rec.username;
}

/** Connect by pasting the prompted-auth session (works for Google accounts). */
export async function connectSession(
  pasted: PromptedSession,
  timezone: string | undefined,
  deviceId: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const verification = await verifyToken(pasted.access_token);
  if (!verification.ok) {
    return { ok: false, error: `Prompted rejected this token: ${verification.error}` };
  }
  const username = await persistConnection(
    pasted,
    verification.user.username ?? "",
    verification.user.email,
    timezone,
    deviceId,
  );
  return { ok: true, username };
}

/**
 * Connect by signing in directly with email + password — mints an
 * INDEPENDENT Supabase session (own refresh-token family) that the user's
 * open prmpted.com tab can never invalidate, and stores the password
 * encrypted so PostRelay can re-sign-in itself if the session is ever lost.
 */
export async function connectWithPassword(
  email: string,
  password: string,
  timezone: string | undefined,
  deviceId: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  if (!email || !password || !deviceId) {
    return { ok: false, error: "Email, password and a device id are required" };
  }
  const signedIn = await signInWithPassword(email.trim(), password);
  if (!signedIn.ok) return { ok: false, error: signedIn.error };
  const username = await persistConnection(
    signedIn.session,
    extractUser(signedIn.session.user).username ?? "",
    signedIn.session.user.email,
    timezone,
    deviceId,
    encryptJSON(password),
  );
  return { ok: true, username };
}

export async function setNeedsReconnect(userId: string, v: boolean): Promise<void> {
  const rec = await getUserRecord(userId);
  if (rec) {
    rec.needsReconnect = v;
    await saveUserRecord(rec);
  }
}

export interface TokenResult {
  ok: boolean;
  accessToken?: string;
  error?: string;
}

/**
 * Return a definitely-fresh access token for one account, refreshing via
 * Supabase when within the expiry buffer (rotating BOTH tokens in storage).
 * Password-mode accounts self-heal: if refresh fails, re-sign-in with the
 * stored (encrypted) credentials instead of demanding a reconnect.
 */
export async function getFreshAccessToken(userId: string): Promise<TokenResult> {
  const rec = await getUserRecord(userId);
  if (!rec) return { ok: false, error: "No connected Prompted account" };
  const pwdEnc = await getPasswordEnc(userId);
  const enc = await getSessionEnc(userId);
  if (!enc) {
    await setNeedsReconnect(userId, true);
    return { ok: false, error: "No stored session — reconnect required" };
  }
  // Token-mode accounts that went stale need a manual re-paste.
  if (rec.needsReconnect && !pwdEnc) {
    return { ok: false, error: "Session stale — reconnect required" };
  }

  let session: PromptedSession;
  try {
    session = decryptJSON<PromptedSession>(enc);
  } catch {
    return { ok: false, error: "Stored session could not be decrypted" };
  }

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const needsRefresh =
    !expiresAtMs || expiresAtMs - Date.now() < REFRESH_BUFFER_MIN * MIN;
  const mustHeal = rec.needsReconnect && Boolean(pwdEnc);

  if (needsRefresh || mustHeal) {
    if (needsRefresh) {
      const refreshed = await refreshSession(session.refresh_token);
      if (refreshed.ok) {
        session = refreshed.session;
      } else if (!pwdEnc) {
        await setNeedsReconnect(userId, true);
        return { ok: false, error: refreshed.error };
      } else {
        let password: string;
        try {
          password = decryptJSON<string>(pwdEnc);
        } catch {
          await setNeedsReconnect(userId, true);
          return { ok: false, error: "Stored credentials could not be decrypted" };
        }
        const signedIn = await signInWithPassword(rec.email ?? "", password);
        if (!signedIn.ok) {
          await setNeedsReconnect(userId, true);
          return {
            ok: false,
            error: `Sign-in failed (${signedIn.error}) — password changed?`,
          };
        }
        session = signedIn.session;
      }
    }
    await setSessionEnc(userId, encryptJSON(session));
    const latest = await getUserRecord(userId);
    if (latest) {
      latest.needsReconnect = false;
      latest.refreshedAt = new Date().toISOString();
      await saveUserRecord(latest);
    }
    return { ok: true, accessToken: session.access_token };
  }

  return { ok: true, accessToken: session.access_token };
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
 * Change one account's timezone. "shift" reinterprets not-yet-fired posts'
 * wall-clock time in the new zone (9:00am stays 9:00am — the absolute moment
 * changes); "keep" preserves absolute instants.
 */
export async function changeTimezone(
  userId: string,
  newZone: string | undefined,
  reinterpret: "shift" | "keep" | undefined,
): Promise<TimezoneChange> {
  const rec = await getUserRecord(userId);
  if (!rec) return { ok: false, error: "No connected account" };
  const tz = safeZone(newZone);
  if (tz.timezone === rec.timezone) {
    await saveUserRecord({ ...rec, timezone: tz.timezone, tzFallback: tz.tzFallback });
    return { ok: true, ...tz, shiftedPosts: 0, shiftedBatches: 0 };
  }
  const oldZone = isValidZone(rec.timezone) ? rec.timezone : "UTC";

  let shiftedPosts = 0;
  let shiftedBatches = 0;
  if (reinterpret === "shift") {
    const posts = await getPosts(userId);
    for (const p of posts) {
      if (p.status === "queued" || p.status === "in_progress" || p.status === "draft") {
        const shifted = DateTime.fromISO(p.fireAt)
          .setZone(oldZone)
          .setZone(tz.timezone, { keepLocalTime: true })
          .toUTC()
          .toISO()!;
        await savePost(userId, { ...p, fireAt: shifted });
        shiftedPosts++;
      }
    }
    const batches = await getBatches(userId);
    for (const b of batches) {
      await saveBatch(userId, { ...b, timezone: tz.timezone });
      shiftedBatches++;
    }
  }

  await saveUserRecord({ ...rec, timezone: tz.timezone, tzFallback: tz.tzFallback });
  return { ok: true, ...tz, shiftedPosts, shiftedBatches };
}

/** Daily reference-data sync (categories / ai_tools / communities). */
export async function syncRefs(
  force = false,
): Promise<{ synced: boolean; error?: string }> {
  const existing = await getRefs();
  const staleAfter = 20 * 60 * MIN;
  if (!force && existing?.syncedAt) {
    if (Date.now() - new Date(existing.syncedAt).getTime() < staleAfter) {
      return { synced: false };
    }
  }
  // Primary path: any connected account's fresh token (drip through users).
  // Fallback: the tables are anon-readable, so sync never silently stops.
  let token: string | undefined;
  const { getAllUserIds } = await import("./data");
  for (const uid of await getAllUserIds()) {
    const t = await getFreshAccessToken(uid);
    if (t.ok && t.accessToken) {
      token = t.accessToken;
      break;
    }
  }
  try {
    const refs = await (await import("./prompted")).fetchRefs(token);
    await saveRefs(refs);
    return { synced: true };
  } catch (e) {
    return { synced: false, error: e instanceof Error ? e.message : "sync failed" };
  }
}
