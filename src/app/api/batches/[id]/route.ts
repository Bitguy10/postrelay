import { NextRequest, NextResponse } from "next/server";
import { getBatch, getPosts, saveBatch, savePost } from "@/lib/data";
import { recomputeSlots } from "@/lib/scheduler";
import { isValidZone } from "@/lib/time";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

interface PatchBody {
  status?: "active" | "paused";
  intervalDays?: number;
  timeOfDay?: string;
  timezone?: string;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const batch = await getBatch(params.id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  let b: PatchBody;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Pause/resume only stops future auto-assignment. Posts already in slots
  // keep firing — that's the point of "pause", not "delete the schedule".
  if (b.status === "active" || b.status === "paused") {
    await saveBatch({ ...batch, status: b.status });
    return NextResponse.json({ batch: { ...batch, status: b.status } });
  }

  // Cadence edit: recompute future slot times for not-yet-fired posts only.
  const intervalDays =
    b.intervalDays && b.intervalDays >= 1 && b.intervalDays <= 30
      ? Math.round(b.intervalDays)
      : batch.intervalDays;
  const timeOfDay = b.timeOfDay?.match(/^\d{2}:\d{2}$/) ? b.timeOfDay : batch.timeOfDay;
  const timezone = isValidZone(b.timezone) ? b.timezone : batch.timezone;

  const updated = { ...batch, intervalDays, timeOfDay, timezone };
  await saveBatch(updated);

  if (
    intervalDays !== batch.intervalDays ||
    timeOfDay !== batch.timeOfDay ||
    timezone !== batch.timezone
  ) {
    const posts = await getPosts();
    const { updated: posts2 } = recomputeSlots(updated, posts);
    for (const p of posts2) await savePost(p);
  }

  return NextResponse.json({ batch: updated });
}
