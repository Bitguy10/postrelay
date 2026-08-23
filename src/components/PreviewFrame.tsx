"use client";

import { MediaRef, Post, Refs } from "@/lib/types";

// Preview-as-Prompted: deliberately styled like a Prompted post card inside a
// dashed frame — visually distinct from Cadence's own chrome, with an explicit
// "not yet live" state. Inferred rendering of what prmpted.com will show.

function MediaGrid({ media }: { media: MediaRef[] }) {
  const images = media.filter((m) => m.kind === "image");
  if (!images.length) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {images.map((m, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={m.url}
          alt={m.name}
          className="h-32 w-full rounded-xl border border-[#262624] object-cover"
        />
      ))}
    </div>
  );
}

function Chips({ items, label }: { items: string[]; label?: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {label && (
        <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-[#7a7a72]">
          {label}
        </span>
      )}
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full border border-[#2a2a27] bg-[#161614] px-2.5 py-0.5 text-[11px] text-[#c9c9c0]"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export default function PreviewFrame({
  post,
  username,
  refs,
}: {
  post: Post;
  username: string;
  refs: Refs | null;
}) {
  const catNames = post.categoryIds
    .map((id) => refs?.categories.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];
  const comNames = post.communityIds
    .map((id) => refs?.communities.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];

  const toolLabel =
    post.type === "build" || post.type === "video" ? "Built with" : "Tools mentioned";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Prmpted.com preview
        </span>
        {post.status === "posted" ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-good">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-good" />
            Live
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-gold">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold animate-pulse-dot" />
            Not yet live
          </span>
        )}
      </div>

      <div className="preview-frame p-4">
        {/* Prompted-style post card */}
        <article className="rounded-2xl border border-[#262624] bg-[#131311] p-4">
          <header className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#22221e] font-display text-sm text-[#d8d8cf]">
              {(username || "you").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-sm font-medium text-[#edede8]">@{username || "you"}</p>
              <p className="font-mono text-[10px] text-[#7a7a72]">
                just now · {post.type === "question" ? "asked a question" : post.type === "build" ? "shipped a build" : `posted a ${post.type}`}
              </p>
            </div>
            {post.difficulty && post.type === "build" && (
              <span className="ml-auto rounded-md border border-[#2a2a27] px-2 py-0.5 font-mono text-[9px] uppercase text-[#c9c9c0]">
                {post.difficulty}
              </span>
            )}
          </header>

          {/* Title / question */}
          <h2
            className={`mt-3 font-serif leading-snug text-[#f3f3ee] ${
              post.type === "question" ? "text-lg italic" : "text-xl"
            }`}
            style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
          >
            {post.title || (
              <span className="text-[#7a7a72] italic">
                {post.type === "build"
                  ? "What did you build?"
                  : post.type === "video"
                    ? "Video title"
                    : "Your question / title"}
              </span>
            )}
          </h2>

          {post.body && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#c9c9c0]">
              {post.body}
            </p>
          )}

          {/* Build: the prompt steps */}
          {post.type === "build" && post.promptSteps.length > 0 && (
            <div className="mt-3 rounded-xl border border-[#2a2a27] bg-[#0f0f0e] p-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#7a7a72]">
                The prompt
              </p>
              <ol className="mt-2 space-y-2">
                {post.promptSteps.map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-0.5 font-mono text-[10px] text-[#F0A83A]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#b9b9b0]">
                      {s.prompt_text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Discussion poll */}
          {post.type === "discussion" && post.pollEnabled &&
            (post.pollOptions ?? []).filter((o) => o.trim()).length >= 2 && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-[#2a2a27] bg-[#0f0f0e] p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#7a7a72]">
                  Poll
                </p>
                {(post.pollOptions ?? [])
                  .filter((o) => o.trim())
                  .map((o, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 rounded-lg border border-[#262624] px-3 py-2 text-sm text-[#c9c9c0]"
                    >
                      <span className="h-3.5 w-3.5 rounded-full border border-[#3a3a36]" />
                      {o}
                    </div>
                  ))}
              </div>
            )}

          {/* Video */}
          {post.type === "video" &&
            (post.video ? (
              post.video.url.startsWith("http") && !post.video.path ? (
                <a
                  href={post.video.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block rounded-xl border border-[#2a2a27] bg-[#0f0f0e] px-4 py-8 text-center font-mono text-xs text-[#7a7a72]"
                >
                  ▶ {post.video.name || post.video.url}
                </a>
              ) : (
                <video
                  src={post.video.url}
                  controls
                  className="mt-3 w-full rounded-xl border border-[#262624]"
                />
              )
            ) : null)}

          {/* Links */}
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            {post.type === "build" && post.link && (
              <a href={post.link} target="_blank" rel="noreferrer" className="text-[#F0A83A] underline decoration-[#F0A83A]/40 underline-offset-2">
                View build ↗
              </a>
            )}
            {post.type === "discussion" && post.link && (
              <a href={post.link} target="_blank" rel="noreferrer" className="text-[#F0A83A] underline decoration-[#F0A83A]/40 underline-offset-2">
                {post.link} ↗
              </a>
            )}
            {post.type === "video" && post.link && (
              <a href={post.link} target="_blank" rel="noreferrer" className="text-[#F0A83A] underline decoration-[#F0A83A]/40 underline-offset-2">
                Demo ↗
              </a>
            )}
            {post.type === "video" && post.githubUrl && (
              <a href={post.githubUrl} target="_blank" rel="noreferrer" className="text-[#c9c9c0] underline underline-offset-2">
                GitHub ↗
              </a>
            )}
            {post.remixUrl && (
              <span className="font-mono text-[10px] text-[#7a7a72]">
                {post.type === "build" ? "remix of" : "repost of"} {post.remixUrl}
              </span>
            )}
            {post.type === "build" && post.designDoc && (
              <span className="font-mono text-[10px] text-[#7a7a72]">
                📄 design doc: {post.designDoc.name}
              </span>
            )}
          </div>

          <MediaGrid media={post.media} />

          <Chips items={catNames} label="in" />
          <Chips items={post.toolNames} label={toolLabel} />
          {post.type === "video" && <Chips items={comNames} label="topics" />}
          {post.type !== "video" && <Chips items={comNames} label="to" />}
        </article>
      </div>

      <p className="mt-2 text-center font-mono text-[10px] text-muted/60">
        Inferred rendering — prmpted.com applies its own final layout.
      </p>
    </div>
  );
}
