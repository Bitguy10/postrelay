import { anonKey, PROMPTED_SUPABASE_URL } from "./env";
import { Post } from "./types";

// Post submission via Prompted's Supabase PostgREST API — replicated from
// their own composer bundle: a single insert into `posts` with inline fields,
// then `community_posts` rows for cross-posting, then an optional design doc
// upsert into `post_design_docs` + `posts.design_doc_url` update.

function restHeaders(accessToken: string): Record<string, string> {
  return {
    apikey: anonKey(),
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "accept-profile": "public",
    "x-client-info": "postrelay/1.0",
    Prefer: "return=representation",
  };
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.message || body.error || body.hint || JSON.stringify(body);
  } catch {
    return `HTTP ${res.status}`;
  }
}

const POST_TYPE: Record<Post["type"], string> = {
  build: "build",
  discussion: "discussion",
  video: "video",
  question: "question",
};

/** Prompted slugifies tool names into tool_ids (lowercase, hyphens). */
const slug = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, "-");

/** Pull a Prompted post id out of a permalink (…/post/<uuid> or raw uuid). */
export function postIdFromUrl(url: string): string | null {
  const m = url.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0] : null;
}

function buildRow(post: Post, userId: string): Record<string, unknown> {
  const images = post.media.filter((m) => m.kind === "image").map((m) => m.url);
  const videos =
    post.type === "video" && post.video
      ? [{ url: post.video.url, path: post.video.path ?? "", type: "video" }]
      : post.media
          .filter((m) => m.kind === "video")
          .map((m) => ({ url: m.url, path: m.path ?? "", type: "video" }));

  const row: Record<string, unknown> = {
    user_id: userId,
    title: post.title,
    description: post.body || null,
    category_id: post.categoryIds[0] ?? null,
    category_ids: post.categoryIds.length ? post.categoryIds : null,
    demo_url: post.link || null,
    github_repo_url: post.githubUrl || null,
    ai_tool: post.toolNames.length ? post.toolNames.join(", ") : null,
    tool_ids: post.toolNames.length ? post.toolNames.map(slug) : null,
    images: images.length ? images : null,
    videos: videos.length ? videos : null,
    has_video: videos.length > 0,
    video_url: post.type === "video" && post.video ? post.video.url : null,
    is_question: post.type === "question",
    post_type: POST_TYPE[post.type],
    difficulty: post.type === "build" ? post.difficulty || null : null,
  };

  // Build: multi-step prompt ("The Prompt You Used")
  if (post.type === "build" && post.promptSteps.length) {
    row.prompt = post.promptSteps.map((s) => s.prompt_text.trim()).join("\n\n");
    row.prompt_steps = post.promptSteps.map((s, i) => ({
      step_number: s.step_number || i + 1,
      prompt_text: s.prompt_text,
    }));
  }

  // Discussion: poll options [{id, text}] (max 6, min 2)
  if (
    post.type === "discussion" &&
    post.pollEnabled &&
    (post.pollOptions ?? []).filter((o) => o.trim()).length >= 2
  ) {
    row.poll_options = (post.pollOptions ?? [])
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((text, i) => ({ id: `opt${i + 1}`, text }));
  }

  // Remix / repost link → fork reference (builds remix; others repost)
  if (post.remixUrl) {
    const forkedId = postIdFromUrl(post.remixUrl);
    if (forkedId) {
      row.forked_from_post_id = forkedId;
      row.fork_type = post.type === "build" ? "remix" : "repost";
    }
  }

  return row;
}

export interface SubmitResult {
  ok: boolean;
  postId?: string;
  error?: string;
  authFailed?: boolean;
}

/** Submit one post to Prompted as the connected user. */
export async function submitPost(
  post: Post,
  userId: string,
  accessToken: string,
): Promise<SubmitResult> {
  const row = buildRow(post, userId);
  const base = PROMPTED_SUPABASE_URL;

  const insertRes = await fetch(`${base}/rest/v1/posts`, {
    method: "POST",
    headers: restHeaders(accessToken),
    body: JSON.stringify(row),
  });

  if (!insertRes.ok) {
    const error = await readError(insertRes);
    return {
      ok: false,
      error,
      authFailed: insertRes.status === 401 || insertRes.status === 403,
    };
  }

  const inserted = (await insertRes.json()) as { id: string }[];
  const newId = inserted[0]?.id;

  // Cross-post to communities (best-effort — matches their composer, which
  // logs but does not fail the post if this insert errors).
  if (newId && post.communityIds.length) {
    await fetch(`${base}/rest/v1/community_posts`, {
      method: "POST",
      headers: restHeaders(accessToken),
      body: JSON.stringify(
        post.communityIds.map((community_id) => ({
          community_id,
          post_id: newId,
        })),
      ),
    });
  }

  // Design doc: Prompted hosts the HTML in post_design_docs and links it
  // from posts.design_doc_url (https://prmpted.com/design-docs/<post id>).
  if (newId && post.designDoc?.html?.trim()) {
    const upsert = await fetch(`${base}/rest/v1/post_design_docs`, {
      method: "POST",
      headers: { ...restHeaders(accessToken), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        post_id: newId,
        user_id: userId,
        html: post.designDoc.html,
      }),
    });
    if (upsert.ok) {
      await fetch(`${base}/rest/v1/posts?id=eq.${newId}`, {
        method: "PATCH",
        headers: restHeaders(accessToken),
        body: JSON.stringify({
          design_doc_url: `https://prmpted.com/design-docs/${newId}`,
        }),
      });
    }
  }

  return { ok: true, postId: newId };
}
