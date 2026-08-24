import { NextResponse } from "next/server";
import { getSessionRecord } from "@/lib/data";
import { getFreshAccessToken } from "@/lib/session";
import { anonKey, PROMPTED_SUPABASE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * One-shot upload credential so the browser can put media straight into
 * Prompted's Supabase storage buckets — bypassing Vercel's 4.5MB request-body
 * cap, which limited the old server-proxy route to ~3MB files.
 *
 * Security: the access token is returned into page memory for the duration of
 * a single upload and never persisted client-side (no localStorage, no state).
 * Prompted's own site holds this same token in localStorage at all times, so
 * this is no weaker than prmpted.com itself. The token still never appears in
 * logs or any other API response.
 */
export async function POST() {
  const rec = await getSessionRecord();
  if (!rec || rec.needsReconnect) {
    return NextResponse.json(
      { error: "Connect your Prompted account before uploading media" },
      { status: 401 },
    );
  }
  const token = await getFreshAccessToken();
  if (!token.ok || !token.accessToken) {
    return NextResponse.json({ error: token.error }, { status: 401 });
  }
  return NextResponse.json(
    {
      supabaseUrl: PROMPTED_SUPABASE_URL,
      anonKey: anonKey(),
      accessToken: token.accessToken,
      userId: rec.user.id,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
