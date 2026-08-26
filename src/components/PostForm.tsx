"use client";

import { useRef } from "react";
import { Post, Refs } from "@/lib/types";
import MediaInput from "./MediaInput";
import MultiSelect from "./MultiSelect";

// Compose fields mirroring Prompted's real composer, per post type.

function Req() {
  return <span className="text-gold"> · required</span>;
}

export default function PostForm({
  post,
  patch,
  refs,
}: {
  post: Post;
  patch: (p: Partial<Post>) => void;
  refs: Refs | null;
}) {
  const designDocRef = useRef<HTMLInputElement>(null);

  const catOptions = (refs?.categories ?? []).map((c) => ({ id: c.id, label: c.name }));
  const toolOptions = (refs?.tools ?? []).map((t) => ({ id: t.id, label: t.name }));
  const comOptions = (refs?.communities ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.member_count != null ? `${c.member_count} members` : undefined,
  }));

  const setStep = (i: number, text: string) => {
    const steps = post.promptSteps.map((s, j) =>
      j === i ? { ...s, prompt_text: text } : s,
    );
    patch({ promptSteps: steps });
  };

  const readDesignDoc = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      patch({ designDoc: null });
      alert("Design docs are capped at 2MB — same as Prompted's own uploader.");
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const text = String(r.result);
      const html = /\.html?$/i.test(file.name)
        ? text
        : `<pre style="white-space:pre-wrap;font-family:inherit">${text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</pre>`;
      patch({ designDoc: { name: file.name, html } });
    };
    r.readAsText(file);
  };

  return (
    <div className="space-y-5">
      {/* ---------- shared: title-ish primary field ---------- */}
      {post.type === "build" && (
        <div>
          <span className="label">What did you build?<Req /></span>
          <input
            className="field"
            value={post.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="A Chrome extension that turns tab overload into a queue…"
          />
        </div>
      )}
      {post.type === "discussion" && (
        <div>
          <span className="label">Title<Req /></span>
          <input
            className="field"
            value={post.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="What's your honest take on vibe-coding production apps?"
          />
        </div>
      )}
      {post.type === "video" && (
        <div>
          <span className="label">Title<Req /></span>
          <input
            className="field"
            value={post.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Building a synth from scratch with Claude"
          />
        </div>
      )}
      {post.type === "question" && (
        <div>
          <span className="label">Your Question<Req /></span>
          <textarea
            className="field min-h-[80px]"
            value={post.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="How do you keep long agents from drifting off-task?"
          />
        </div>
      )}

      {/* ---------- body / rich text ---------- */}
      {(post.type === "build" || post.type === "discussion") && (
        <div>
          <span className="label">
            {post.type === "build" ? "Explain your post" : "Body"}
            {post.type === "discussion" && <Req />}
          </span>
          <textarea
            className="field min-h-[120px]"
            value={post.body}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder={
              post.type === "build"
                ? "What it does, why you built it, what surprised you…"
                : "Say the thing…"
            }
          />
          <p className="mt-1 font-mono text-[10px] text-muted/60">
            rich text — markdown & links supported
          </p>
        </div>
      )}
      {post.type === "video" && (
        <div>
          <span className="label">Description</span>
          <textarea
            className="field min-h-[80px]"
            value={post.body}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder="What the demo shows…"
          />
          <p className="mt-1 font-mono text-[10px] text-muted/60">
            rich text — markdown & links supported
          </p>
        </div>
      )}
      {post.type === "question" && (
        <div>
          <span className="label">Details</span>
          <textarea
            className="field min-h-[100px]"
            value={post.body}
            onChange={(e) => patch({ body: e.target.value })}
            placeholder="Context, what you've already tried…"
          />
          <p className="mt-1 font-mono text-[10px] text-muted/60">
            rich text — markdown & links supported
          </p>
        </div>
      )}

      {/* ---------- build: the prompt you used ---------- */}
      {post.type === "build" && (
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="label mb-0">The Prompt You Used<Req /></span>
          </div>
          <div className="mt-3 space-y-3">
            {post.promptSteps.map((s, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="mt-3 font-mono text-xs text-gold">
                  {String(s.step_number).padStart(2, "0")}
                </span>
                <textarea
                  className="field min-h-[64px] flex-1 font-mono text-[13px]"
                  value={s.prompt_text}
                  onChange={(e) => setStep(i, e.target.value)}
                  placeholder={i === 0 ? "Step 1 — the opening prompt…" : "Next step…"}
                />
                {post.promptSteps.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      patch({
                        promptSteps: post.promptSteps
                          .filter((_, j) => j !== i)
                          .map((s2, j) => ({ ...s2, step_number: j + 1 })),
                      })
                    }
                    className="mt-2 h-8 w-8 shrink-0 rounded-full border border-line text-muted hover:border-bad/40 hover:text-bad"
                    aria-label="Remove step"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              patch({
                promptSteps: [
                  ...post.promptSteps,
                  { step_number: post.promptSteps.length + 1, prompt_text: "" },
                ],
              })
            }
            className="mt-3 rounded-full border border-dashed border-line px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted hover:border-gold/60 hover:text-gold"
          >
            + Add another step
          </button>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted hover:text-gold">
              What if I have too many prompts?
            </summary>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Condense to the 3–5 steps that actually matter, and link the full
              transcript in your build URL or design doc. Long step chains get
              truncated in the feed.
            </p>
          </details>
        </div>
      )}

      {/* ---------- discussion: poll ---------- */}
      {post.type === "discussion" && (
        <div>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-cream">
            <input
              type="checkbox"
              checked={Boolean(post.pollEnabled)}
              onChange={(e) => patch({ pollEnabled: e.target.checked })}
              className="h-4 w-4 accent-[#F0A83A]"
            />
            Add a poll
          </label>
          {post.pollEnabled && (
            <div className="mt-3 space-y-2">
              {(post.pollOptions ?? []).map((o, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="field flex-1"
                    value={o}
                    onChange={(e) => {
                      const opts = [...(post.pollOptions ?? [])];
                      opts[i] = e.target.value;
                      patch({ pollOptions: opts });
                    }}
                    placeholder={`Option ${i + 1}`}
                  />
                  {(post.pollOptions ?? []).length > 2 && (
                    <button
                      type="button"
                      onClick={() =>
                        patch({
                          pollOptions: (post.pollOptions ?? []).filter((_, j) => j !== i),
                        })
                      }
                      className="rounded-full border border-line px-3 text-muted hover:border-bad/40 hover:text-bad"
                      aria-label="Remove option"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {(post.pollOptions ?? []).length < 6 && (
                <button
                  type="button"
                  onClick={() => patch({ pollOptions: [...(post.pollOptions ?? []), ""] })}
                  className="rounded-full border border-dashed border-line px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted hover:border-gold/60 hover:text-gold"
                >
                  + Add option
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- links ---------- */}
      {post.type === "build" && (
        <div>
          <span className="label">Link to your build<Req /></span>
          <input
            className="field"
            type="url"
            value={post.link ?? ""}
            onChange={(e) => patch({ link: e.target.value })}
            placeholder="https://…"
          />
        </div>
      )}
      {post.type === "discussion" && (
        <div>
          <span className="label">Link</span>
          <input
            className="field"
            type="url"
            value={post.link ?? ""}
            onChange={(e) => patch({ link: e.target.value })}
            placeholder="https://… (optional)"
          />
        </div>
      )}
      {post.type === "video" && (
        <>
          <div>
            <span className="label">Demo URL</span>
            <input
              className="field"
              type="url"
              value={post.link ?? ""}
              onChange={(e) => patch({ link: e.target.value })}
              placeholder="https://your-demo.com (optional)"
            />
          </div>
          <div>
            <span className="label">GitHub repo</span>
            <input
              className="field"
              type="url"
              value={post.githubUrl ?? ""}
              onChange={(e) => patch({ githubUrl: e.target.value })}
              placeholder="https://github.com/you/repo (optional)"
            />
          </div>
        </>
      )}

      {/* ---------- remix / repost ---------- */}
      {post.type !== "video" && (
        <div>
          <span className="label">
            {post.type === "build" ? "Is this a remix? (URL of the original)" : "Remix / repost link"}
          </span>
          <input
            className="field"
            type="url"
            value={post.remixUrl ?? ""}
            onChange={(e) => patch({ remixUrl: e.target.value })}
            placeholder="https://prmpted.com/post/… (optional)"
          />
          {post.type !== "build" && (
            <p className="mt-1 font-mono text-[10px] text-muted/60">
              embeds the linked post
            </p>
          )}
        </div>
      )}

      {/* ---------- build: design doc ---------- */}
      {post.type === "build" && (
        <div>
          <span className="label">Design doc</span>
          <input
            ref={designDocRef}
            type="file"
            accept=".md,.txt,.html"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readDesignDoc(f);
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => designDocRef.current?.click()}
              className="rounded-full border border-dashed border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted hover:border-gold/60 hover:text-gold"
            >
              Upload doc
            </button>
            {post.designDoc ? (
              <span className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-panel2 px-3 py-1.5 text-xs text-muted">
                <span className="truncate">📄 {post.designDoc.name}</span>
                <button type="button" onClick={() => patch({ designDoc: null })} className="hover:text-bad" aria-label="Remove design doc">
                  ✕
                </button>
              </span>
            ) : (
              <span className="font-mono text-[10px] text-muted/60">
                .md / .txt / .html — optional
              </span>
            )}
          </div>
        </div>
      )}

      {/* ---------- build: difficulty ---------- */}
      {post.type === "build" && (
        <div>
          <span className="label">Difficulty</span>
          <div className="flex gap-2">
            {["beginner", "intermediate", "advanced"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => patch({ difficulty: post.difficulty === d ? undefined : d })}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition-colors ${
                  post.difficulty === d
                    ? "border-gold/60 bg-gold/10 text-gold"
                    : "border-line text-muted hover:text-cream"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------- category ---------- */}
      {(post.type === "build" || post.type === "discussion" || post.type === "question") && (
        <div>
          <span className="label">Category</span>
          <MultiSelect
            options={catOptions}
            value={post.categoryIds}
            onChange={(ids) => patch({ categoryIds: ids })}
            placeholder="Pick a category…"
            multi={false}
          />
        </div>
      )}

      {/* ---------- tools ---------- */}
      {post.type !== "question" ? (
        <div>
          <span className="label">{post.type === "build" || post.type === "video" ? "Built With" : "Tools Mentioned"}</span>
          <MultiSelect
            options={toolOptions}
            value={post.toolNames}
            onChange={(names) => patch({ toolNames: names })}
            placeholder="Search tools…"
          />
        </div>
      ) : (
        <div>
          <span className="label">Tools Mentioned</span>
          <MultiSelect
            options={toolOptions}
            value={post.toolNames}
            onChange={(names) => patch({ toolNames: names })}
            placeholder="Search tools…"
          />
        </div>
      )}

      {/* ---------- video: topics (same pool as communities) ---------- */}
      {post.type === "video" && (
        <div>
          <span className="label">Topics<Req /></span>
          <MultiSelect
            options={comOptions}
            value={post.communityIds}
            onChange={(ids) => patch({ communityIds: ids })}
            placeholder="Pick topics…"
          />
          <p className="mt-1 font-mono text-[10px] text-muted/60">
            topics draw from Prompted&apos;s community pool
          </p>
        </div>
      )}

      {/* ---------- post to community ---------- */}
      {post.type !== "video" && (
        <div>
          <span className="label">Post to Community</span>
          <MultiSelect
            options={comOptions}
            value={post.communityIds}
            onChange={(ids) => patch({ communityIds: ids })}
            placeholder="Cross-post to communities… (optional)"
          />
        </div>
      )}

      {/* ---------- media ---------- */}
      {post.type === "build" && (
        <MediaInput
          label="Project Media"
          required
          accept="image/*,video/mp4,video/webm,video/quicktime"
          kinds="any"
          multiple
          value={post.media}
          onChange={(media) => patch({ media })}
          hint="images up to 5MB · videos up to 150MB"
        />
      )}
      {post.type === "video" && (
        <MediaInput
          label="Video"
          required
          accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime"
          kinds="video"
          multiple={false}
          value={post.video ? [post.video] : []}
          onChange={(items) => patch({ video: items[0] ?? null })}
          hint=".mp4 / .webm / .mov · up to 150MB"
        />
      )}
      {(post.type === "discussion" || post.type === "question") && (
        <MediaInput
          label="Media"
          accept="image/*"
          kinds="image"
          multiple
          value={post.media}
          onChange={(media) => patch({ media })}
          hint="optional"
        />
      )}
    </div>
  );
}
