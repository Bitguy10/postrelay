import { NextRequest, NextResponse } from "next/server";
import { clearSession, getSessionRecord } from "@/lib/data";
import { changeTimezone, connectSession } from "@/lib/session";
import { parsePastedSession } from "@/lib/validate";
import { cronSecret, encryptionKeySecret, redisConfigured } from "@/lib/env";
import { isValidZone, zoneAbbr } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const rec = await getSessionRecord();
  const stored = rec?.timezone;
  const valid = isValidZone(stored);
  const timezone = rec ? (valid ? stored! : "UTC") : null;
  return NextResponse.json(
    {
      connected: Boolean(rec),
      username: rec?.user.username ?? null,
      email: rec?.user.email ?? null,
      needsReconnect: rec?.needsReconnect ?? false,
      refreshedAt: rec?.refreshedAt ?? null,
      connectedAt: rec?.connectedAt ?? null,
      timezone,
      tzAbbr: timezone ? zoneAbbr(timezone) : null,
      tzFallback: rec ? rec.tzFallback || !valid : false,
      config: {
        redis: redisConfigured(),
        encryptionKey: Boolean(encryptionKeySecret()),
        cronSecret: Boolean(cronSecret()),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let body: { sessionJson?: string; timezone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.sessionJson) {
    return NextResponse.json({ error: "sessionJson is required" }, { status: 400 });
  }
  if (!encryptionKeySecret()) {
    return NextResponse.json(
      { error: "CADENCE_ENCRYPTION_KEY is not set — cannot encrypt your session" },
      { status: 500 },
    );
  }
  const parsed = parsePastedSession(body.sessionJson);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await connectSession(parsed.session, body.timezone);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  // The token is never returned — only the confirmation of who we connected as.
  const tz = isValidZone(body.timezone) ? body.timezone : "UTC";
  return NextResponse.json({
    connected: true,
    username: result.username,
    timezone: tz,
    tzFallback: !isValidZone(body.timezone) && Boolean(body.timezone),
  });
}

/** Change the stored timezone (optionally reinterpreting queued posts). */
export async function PATCH(req: NextRequest) {
  let body: { timezone?: string; reinterpret?: "shift" | "keep" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.timezone) {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 });
  }
  const result = await changeTimezone(body.timezone, body.reinterpret);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    connected: true,
    timezone: result.timezone,
    tzAbbr: zoneAbbr(result.timezone!),
    tzFallback: result.tzFallback,
    shiftedPosts: result.shiftedPosts ?? 0,
    shiftedBatches: result.shiftedBatches ?? 0,
  });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ connected: false });
}
