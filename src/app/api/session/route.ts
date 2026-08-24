import { NextRequest, NextResponse } from "next/server";
import { getHeartbeat, unbindDevice } from "@/lib/data";
import { changeTimezone, connectSession, connectWithPassword } from "@/lib/session";
import { parsePastedSession } from "@/lib/validate";
import { cronSecret, encryptionKeySecret, redisConfigured } from "@/lib/env";
import { isValidZone, zoneAbbr, MIN } from "@/lib/time";
import { currentUser, DEVICE_HEADER } from "@/lib/user";

export const dynamic = "force-dynamic";

// A heartbeat older than this means cron-job.org has stopped reaching us.
const STALE_HEARTBEAT_MS = 10 * MIN;

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  const heartbeat = await getHeartbeat();
  const lastTickMs = heartbeat ? new Date(heartbeat).getTime() : null;
  const valid = isValidZone(user?.timezone);
  const timezone = user ? (valid ? user.timezone : "UTC") : null;
  return NextResponse.json(
    {
      connected: Boolean(user),
      username: user?.username ?? null,
      email: user?.email ?? null,
      needsReconnect: user?.needsReconnect ?? false,
      refreshedAt: user?.refreshedAt ?? null,
      connectedAt: user?.connectedAt ?? null,
      timezone,
      tzAbbr: timezone ? zoneAbbr(timezone) : null,
      tzFallback: user ? user.tzFallback || !valid : false,
      /** "password" = independent self-healing session; "token" = pasted. */
      authMode: user?.authMode ?? null,
      lastTickAt: heartbeat,
      heartbeatStale:
        lastTickMs !== null && Date.now() - lastTickMs > STALE_HEARTBEAT_MS,
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
  let body: {
    sessionJson?: string;
    email?: string;
    password?: string;
    timezone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!encryptionKeySecret()) {
    return NextResponse.json(
      { error: "POSTRELAY_ENCRYPTION_KEY is not set — cannot encrypt your session" },
      { status: 500 },
    );
  }
  const deviceId = req.headers.get(DEVICE_HEADER);
  if (!deviceId) {
    return NextResponse.json(
      { error: "Missing device header — reload the app" },
      { status: 400 },
    );
  }

  // Route 1 — email + password: independent, self-healing session.
  if (body.email || body.password) {
    if (!body.email || !body.password) {
      return NextResponse.json(
        { error: "Both email and password are required" },
        { status: 400 },
      );
    }
    const result = await connectWithPassword(
      body.email,
      body.password,
      body.timezone,
      deviceId,
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    const tz1 = isValidZone(body.timezone) ? body.timezone : "UTC";
    return NextResponse.json({
      connected: true,
      username: result.username,
      authMode: "password",
      timezone: tz1,
      tzFallback: !isValidZone(body.timezone) && Boolean(body.timezone),
    });
  }

  // Route 2 — paste the prompted-auth session (works for Google accounts too).
  if (!body.sessionJson) {
    return NextResponse.json(
      { error: "Provide either email+password or sessionJson" },
      { status: 400 },
    );
  }
  const parsed = parsePastedSession(body.sessionJson);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const result = await connectSession(parsed.session, body.timezone, deviceId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }
  const tz = isValidZone(body.timezone) ? body.timezone : "UTC";
  return NextResponse.json({
    connected: true,
    username: result.username,
    authMode: "token",
    timezone: tz,
    tzFallback: !isValidZone(body.timezone) && Boolean(body.timezone),
  });
}

/** Change the current account's timezone (optionally reinterpreting posts). */
export async function PATCH(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) {
    return NextResponse.json({ error: "No connected account" }, { status: 401 });
  }
  let body: { timezone?: string; reinterpret?: "shift" | "keep" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.timezone) {
    return NextResponse.json({ error: "timezone is required" }, { status: 400 });
  }
  const result = await changeTimezone(user.id, body.timezone, body.reinterpret);
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

/** Sign this browser out — the account's queue and history stay saved. */
export async function DELETE(req: NextRequest) {
  const deviceId = req.headers.get(DEVICE_HEADER);
  if (deviceId) await unbindDevice(deviceId);
  return NextResponse.json({ connected: false });
}
