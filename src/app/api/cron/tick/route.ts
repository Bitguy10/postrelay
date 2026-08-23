import { NextRequest, NextResponse } from "next/server";
import { cronSecret } from "@/lib/env";
import { runTick } from "@/lib/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The cron worker. cron-job.org (free) pings this every 5 minutes with the
 * CRON_SECRET — Vercel Hobby's built-in cron caps at once/day, so the trigger
 * lives outside Vercel. Auth: `Authorization: Bearer <secret>` or `?secret=`.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = cronSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured" },
        { status: 500 },
      );
    }
    // dev: allowed without a secret so the worker is testable locally
  } else {
    const header = req.headers.get("authorization") ?? "";
    const provided =
      header.replace(/^Bearer\s+/i, "") ||
      (req.nextUrl.searchParams.get("secret") ?? "");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const summary = await runTick();
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tick failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
