import { anonKey, PROMPTED_SUPABASE_URL } from "./env";
import { PromptedSession, PromptedUser, Refs } from "./types";

// Server-side client for Prompted's Supabase project — the same REST pattern
// their own frontend uses (PostgREST + GoTrue + Storage). Server-only: the
// user's access token never leaves this process except to Supabase itself.

function baseHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { apikey: anonKey() };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

function restHeaders(token: string): Record<string, string> {
  return {
    ...baseHeaders(token),
    "Content-Type": "application/json",
    Accept: "application/json",
    "accept-profile": "public",
    "x-client-info": "postrelay/1.0",
  };
}

export class AuthError extends Error {}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error || body.message || body.msg || JSON.stringify(body);
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Verify an access token is live and return the owning user. */
export async function verifyToken(
  accessToken: string,
): Promise<{ ok: true; user: PromptedUser } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${PROMPTED_SUPABASE_URL}/auth/v1/user`, {
      headers: baseHeaders(accessToken),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const u = (await res.json()) as PromptedSession["user"];
    return { ok: true, user: extractUser(u, accessToken) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/** Extract a displayable user from Supabase's user object (mirrors their JWT claims). */
export function extractUser(
  u: PromptedSession["user"],
  accessToken?: string,
): PromptedUser {
  let username =
    (u.user_metadata?.username as string | undefined) ??
    (u.raw_user_meta_data?.username as string | undefined);
  if (!username && accessToken) {
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split(".")[1], "base64").toString("utf8"),
      ) as { user_metadata?: { username?: string } };
      username = payload.user_metadata?.username;
    } catch {
      // ignore — fall through to email
    }
  }
  return {
    id: u.id,
    username: username || (u.email ? u.email.split("@")[0] : "you"),
    email: u.email,
  };
}

/**
 * Refresh a session. Supabase ROTATES the refresh token on every call,
 * so the caller must persist both new tokens.
 */
export async function refreshSession(
  refreshToken: string,
): Promise<
  | { ok: true; session: PromptedSession }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(
      `${PROMPTED_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: { ...baseHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401 || res.status === 400
            ? "Refresh token rejected — session expired"
            : await readError(res),
      };
    }
    const session = (await res.json()) as PromptedSession;
    if (!session.access_token || !session.refresh_token) {
      return { ok: false, error: "Malformed refresh response" };
    }
    return { ok: true, session };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Fetch live categories / tools / communities (the confirmed PostgREST calls).
 * Bearer token optional: these tables are publicly readable with the anon key
 * (Prompted's own logged-out site lists them), so reference sync keeps working
 * between connections. The user token is still passed whenever we have one.
 */
export async function fetchRefs(accessToken?: string): Promise<Refs> {
  const url = (path: string) => `${PROMPTED_SUPABASE_URL}/rest/v1/${path}`;
  // No user token → Bearer carries the anon key, exactly like supabase-js
  // does for anonymous requests (the tables are publicly readable).
  const opts = {
    headers: restHeaders(accessToken ?? anonKey()),
    cache: "no-store" as const,
  };

  const [catRes, toolRes, comRes] = await Promise.all([
    fetch(url("categories?select=*&order=display_order.asc"), opts),
    fetch(url("ai_tools?select=id,name&order=name.asc"), opts),
    fetch(
      url(
        "communities_with_stats?select=*&is_public=eq.true&order=member_count.desc",
      ),
      opts,
    ),
  ]);

  if (!catRes.ok || !toolRes.ok || !comRes.ok) {
    const bad = !catRes.ok ? catRes : !toolRes.ok ? toolRes : comRes;
    throw new Error(`Reference sync failed: ${await readError(bad)}`);
  }

  const cats = (await catRes.json()) as { id: string; name: string }[];
  const tools = (await toolRes.json()) as { id: string; name: string }[];
  const coms = (await comRes.json()) as {
    id: string;
    name: string;
    member_count?: number;
  }[];

  return {
    categories: cats.map((c) => ({ id: c.id, name: c.name })),
    tools: tools.map((t) => ({ id: t.id, name: t.name })),
    communities: coms.map((c) => ({
      id: c.id,
      name: c.name,
      member_count: c.member_count,
    })),
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Upload bytes to one of Prompted's storage buckets (post-images / post-videos),
 * mirroring their frontend's path scheme: {userId}/{timestamp}-{rand}.{ext}
 */
export async function uploadToBucket(
  accessToken: string,
  bucket: "post-images" | "post-videos",
  userId: string,
  fileName: string,
  mime: string,
  bytes: Buffer,
): Promise<{ path: string; publicUrl: string }> {
  const ext = (fileName.split(".").pop() || "bin").toLowerCase();
  const rand = Math.random().toString(36).substring(2, 8);
  const path = `${userId}/${Date.now()}-${rand}.${ext}`;
  const res = await fetch(
    `${PROMPTED_SUPABASE_URL}/storage/v1/object/${bucket}/${path}`,
    {
      method: "POST",
      headers: {
        ...baseHeaders(accessToken),
        "Content-Type": mime || "application/octet-stream",
        "x-upsert": "false",
      },
      body: new Uint8Array(bytes),
    },
  );
  if (!res.ok) throw new Error(`Storage upload failed: ${await readError(res)}`);
  return {
    path,
    publicUrl: `${PROMPTED_SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
  };
}
