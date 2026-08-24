import { Post, PromptedSession } from "./types";

/** Per-type required-field checks, mirroring Prompted's own composer rules. */
export function requiredMissing(p: Post): string[] {
  const missing: string[] = [];
  const need = (cond: unknown, label: string) => {
    if (!cond) missing.push(label);
  };
  switch (p.type) {
    case "build":
      need(p.title?.trim(), "What did you build?");
      need(
        (p.promptSteps ?? []).some((s) => s.prompt_text?.trim()),
        "The Prompt You Used",
      );
      need(p.link?.trim(), "Link to your build");
      need(
        (p.media ?? []).some((m) => m.kind === "image" || m.kind === "video"),
        "Project Media (at least one image or video)",
      );
      break;
    case "discussion":
      need(p.title?.trim(), "Title");
      need(p.body?.trim(), "Body");
      if (p.pollEnabled) {
        need(
          (p.pollOptions ?? []).filter((o) => o?.trim()).length >= 2,
          "Poll (needs 2+ options)",
        );
      }
      break;
    case "video":
      need(p.title?.trim(), "Title");
      need((p.communityIds ?? []).length, "Topics");
      need(p.video, "Video upload (.mp4 / .webm / .mov)");
      break;
    case "question":
      need(p.title?.trim(), "Your Question");
      break;
  }
  return missing;
}

/** Parse the pasted "prompted-auth" Local Storage JSON. */
export function parsePastedSession(
  raw: string,
): { ok: true; session: PromptedSession } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error:
        "That isn't valid JSON. Copy the ENTIRE value of the prompted-auth key — braces included.",
    };
  }
  const s = parsed as PromptedSession;
  if (!s || typeof s !== "object") return { ok: false, error: "Not a session object" };
  if (typeof s.access_token !== "string" || !s.access_token) {
    return { ok: false, error: "Missing access_token" };
  }
  if (typeof s.refresh_token !== "string" || !s.refresh_token) {
    return { ok: false, error: "Missing refresh_token — PostRelay needs it to auto-refresh your session" };
  }
  if (!s.user?.id) return { ok: false, error: "Missing user object" };
  return { ok: true, session: s };
}
