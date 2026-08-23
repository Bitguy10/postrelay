import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { deletePost, getBatch, getPost, getPosts, saveBatch, savePost } from "@/lib/data";
import { computeNextSlot } from "@/lib/scheduler";
import { isValidZone } from "@/lib/time";
import { Post } from "@/lib/types";
import { requiredMissing } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post }, { headers: { "Cache-Control": "no-store" } });
}

interface PatchBody extends Partial<Omit<Post, "id" | "createdAt">> {
  retry?: boolean; // re-queue a failed post (resets attempts)
  schedule?: {
    mode: "single" | "drip";
    at?: string;
    batchId?: string;
    newBatch?: { intervalDays: number; timeOfDay: string; timezone?: string };
  };
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const existing = await getPost(params.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let b: PatchBody;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (existing.status === "in_progress") {
    return NextResponse.json(
      { error: "That post is firing right now — try again in a minute" },
      { status: 409 },
    );
  }

  const post: Post = {
    ...existing,
    ...("title" in b ? { title: b.title ?? "" } : {}),
    ...("body" in b ? { body: b.body ?? "" } : {}),
    ...("promptSteps" in b ? { promptSteps: b.promptSteps ?? [] } : {}),
    ...("link" in b ? { link: b.link || undefined } : {}),
    ...("githubUrl" in b ? { githubUrl: b.githubUrl || undefined } : {}),
    ...("remixUrl" in b ? { remixUrl: b.remixUrl || undefined } : {}),
    ...("difficulty" in b ? { difficulty: b.difficulty || undefined } : {}),
    ...("pollEnabled" in b ? { pollEnabled: Boolean(b.pollEnabled) } : {}),
    ...("pollOptions" in b ? { pollOptions: b.pollOptions ?? [] } : {}),
    ...("categoryIds" in b ? { categoryIds: b.categoryIds ?? [] } : {}),
    ...("toolNames" in b ? { toolNames: b.toolNames ?? [] } : {}),
    ...("communityIds" in b ? { communityIds: b.communityIds ?? [] } : {}),
    ...("media" in b ? { media: b.media ?? [] } : {}),
    ...("video" in b ? { video: b.video ?? null } : {}),
    ...("designDoc" in b ? { designDoc: b.designDoc ?? null } : {}),
    ...("fireAt" in b && b.fireAt ? { fireAt: new Date(b.fireAt).toISOString() } : {}),
  };

  // Reschedule: exact time or (re)assign to a drip batch
  if (b.schedule) {
    const s = b.schedule;
    if (s.mode === "single" && s.at && !Number.isNaN(new Date(s.at).getTime())) {
      post.fireAt = new Date(s.at).toISOString();
      post.batchId = null;
    } else if (s.mode === "drip") {
      let batch = s.batchId ? await getBatch(s.batchId) : null;
      if (!batch && s.newBatch) {
        const nb = s.newBatch;
        if (!nb.timeOfDay?.match(/^\d{2}:\d{2}$/) || !(nb.intervalDays >= 1)) {
          return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
        }
        batch = {
          id: crypto.randomUUID(),
          intervalDays: Math.min(30, Math.round(nb.intervalDays)),
          timeOfDay: nb.timeOfDay,
          timezone: isValidZone(nb.timezone) ? nb.timezone : "UTC",
          status: "active",
          createdAt: new Date().toISOString(),
        };
        await saveBatch(batch);
      }
      if (!batch) {
        return NextResponse.json({ error: "Drip batch not found" }, { status: 404 });
      }
      const allPosts = await getPosts();
      post.batchId = batch.id;
      post.fireAt = computeNextSlot(batch, allPosts.filter((p) => p.id !== post.id)).toISOString();
    }
  }

  // Draft → queued (confirm schedule from the preview screen)
  if (b.status === "queued" && existing.status === "draft") {
    const missing = requiredMissing(post);
    if (missing.length) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
    post.status = "queued";
    post.attempts = 0;
    post.nextRetryAt = null;
  }

  // Re-queue a failed post
  if (b.retry && existing.status === "failed") {
    post.status = "queued";
    post.attempts = 0;
    post.nextRetryAt = null;
    post.lastError = null;
  }

  // Content edits to an already-queued post must stay valid
  if (post.status === "queued") {
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

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const post = await getPost(params.id);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.status === "in_progress") {
    return NextResponse.json(
      { error: "That post is firing right now — try again in a minute" },
      { status: 409 },
    );
  }
  await deletePost(params.id);
  return NextResponse.json({ deleted: true });
}
