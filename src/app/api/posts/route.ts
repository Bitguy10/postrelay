import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getBatches, getPosts, saveBatch, savePost } from "@/lib/data";
import { computeNextSlot } from "@/lib/scheduler";
import { requiredMissing } from "@/lib/validate";
import { isValidZone } from "@/lib/time";
import { Batch, Post, PostType, PromptStep } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES: PostType[] = ["build", "discussion", "video", "question"];

export async function GET() {
  const [posts, batches] = await Promise.all([getPosts(), getBatches()]);
  return NextResponse.json(
    { posts, batches },
    { headers: { "Cache-Control": "no-store" } },
  );
}

interface ScheduleBody {
  mode: "single" | "drip";
  at?: string; // single — UTC ISO, converted from the user's zone client-side
  batchId?: string; // drip, existing batch
  newBatch?: { intervalDays: number; timeOfDay: string; timezone?: string };
}

interface CreateBody {
  type: PostType;
  title?: string;
  body?: string;
  promptSteps?: PromptStep[];
  link?: string;
  githubUrl?: string;
  remixUrl?: string;
  difficulty?: string;
  pollEnabled?: boolean;
  pollOptions?: string[];
  categoryIds?: string[];
  toolNames?: string[];
  communityIds?: string[];
  media?: Post["media"];
  video?: Post["video"];
  designDoc?: Post["designDoc"];
  preview?: boolean;
  schedule: ScheduleBody;
}

export async function POST(req: NextRequest) {
  let b: CreateBody;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!TYPES.includes(b.type)) {
    return NextResponse.json({ error: "Unknown post type" }, { status: 400 });
  }

  const posts = await getPosts();

  // Resolve fire time / batch
  let fireAt: string;
  let batchId: string | null = null;
  if (b.schedule?.mode === "drip") {
    let batch: Batch | null = null;
    if (b.schedule.batchId) {
      batch = (await getBatches()).find((x) => x.id === b.schedule!.batchId) ?? null;
      if (!batch) {
        return NextResponse.json({ error: "Drip batch not found" }, { status: 404 });
      }
      if (batch.status === "paused") {
        return NextResponse.json(
          { error: "That drip batch is paused — resume it or pick another" },
          { status: 400 },
        );
      }
    } else if (b.schedule.newBatch) {
      const nb = b.schedule.newBatch;
      if (!nb.timeOfDay?.match(/^\d{2}:\d{2}$/) || !(nb.intervalDays >= 1)) {
        return NextResponse.json(
          { error: "Cadence needs an interval (days) and a time of day" },
          { status: 400 },
        );
      }
      batch = {
        id: crypto.randomUUID(),
        intervalDays: Math.min(30, Math.round(nb.intervalDays)),
        timeOfDay: nb.timeOfDay,
        // invalid/missing zone → UTC (visible fallback warning in the UI)
        timezone: isValidZone(nb.timezone) ? nb.timezone : "UTC",
        status: "active",
        createdAt: new Date().toISOString(),
      };
      await saveBatch(batch);
    } else {
      return NextResponse.json({ error: "Drip schedule needs a batch" }, { status: 400 });
    }
    batchId = batch.id;
    fireAt = computeNextSlot(batch, posts).toISOString();
  } else {
    const at = b.schedule?.at;
    if (!at || Number.isNaN(new Date(at).getTime())) {
      return NextResponse.json({ error: "A valid date/time is required" }, { status: 400 });
    }
    fireAt = new Date(at).toISOString();
  }

  const post: Post = {
    id: crypto.randomUUID(),
    type: b.type,
    status: b.preview ? "draft" : "queued",
    fireAt,
    createdAt: new Date().toISOString(),
    batchId,
    title: b.title ?? "",
    body: b.body ?? "",
    promptSteps: b.promptSteps ?? [],
    link: b.link || undefined,
    githubUrl: b.githubUrl || undefined,
    remixUrl: b.remixUrl || undefined,
    difficulty: b.difficulty || undefined,
    pollEnabled: b.pollEnabled ?? false,
    pollOptions: b.pollOptions ?? [],
    categoryIds: b.categoryIds ?? [],
    toolNames: b.toolNames ?? [],
    communityIds: b.communityIds ?? [],
    media: b.media ?? [],
    video: b.video ?? null,
    designDoc: b.designDoc ?? null,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    postedAt: null,
    lockedAt: null,
  };

  if (!post.status.startsWith("draft")) {
    const missing = requiredMissing(post);
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  await savePost(post);
  return NextResponse.json({ post }, { headers: { "Cache-Control": "no-store" } });
}
