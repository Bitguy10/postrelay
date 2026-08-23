import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getBatches, getPosts, saveBatch } from "@/lib/data";
import { computeNextSlot } from "@/lib/scheduler";
import { isValidZone } from "@/lib/time";
import { Batch } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const [batches, posts] = await Promise.all([getBatches(), getPosts()]);
  const enriched = batches.map((b) => {
    const mine = posts.filter((p) => p.batchId === b.id && p.status !== "draft");
    return {
      ...b,
      counts: {
        total: mine.length,
        posted: mine.filter((p) => p.status === "posted").length,
        queued: mine.filter((p) => p.status === "queued" || p.status === "in_progress").length,
        failed: mine.filter((p) => p.status === "failed").length,
      },
      nextSlot: computeNextSlot(b, posts).toISOString(),
      posts: mine
        .sort((a, b2) => (a.fireAt < b2.fireAt ? -1 : 1))
        .map((p) => ({
          id: p.id,
          title: p.title,
          type: p.type,
          fireAt: p.fireAt,
          status: p.status,
        })),
    };
  });
  return NextResponse.json(
    { batches: enriched },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  let b: {
    intervalDays?: number;
    timeOfDay?: string;
    timezone?: string;
  };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!(b.intervalDays && b.intervalDays >= 1 && b.intervalDays <= 30)) {
    return NextResponse.json(
      { error: "Interval must be 1–30 days" },
      { status: 400 },
    );
  }
  if (!b.timeOfDay?.match(/^\d{2}:\d{2}$/)) {
    return NextResponse.json({ error: "Time of day must be HH:mm" }, { status: 400 });
  }
  const batch: Batch = {
    id: crypto.randomUUID(),
    intervalDays: Math.round(b.intervalDays),
    timeOfDay: b.timeOfDay,
    timezone: isValidZone(b.timezone) ? b.timezone : "UTC",
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await saveBatch(batch);
  return NextResponse.json({ batch });
}
