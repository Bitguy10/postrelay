"use client";

import AppShell from "@/components/AppShell";
import QueueRail, { RailItem } from "@/components/QueueRail";
import { LinkPill } from "@/components/ui";
import { PostsResponse, SessionStatus, useApi } from "@/lib/client";

// Demo rail (not connected): tomorrow 9:00, then every 2 days — the canonical
// drip cadence.
function demoRail(): RailItem[] {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  t.setHours(9, 0, 0, 0);
  return [0, 1, 2].map((i) => {
    const d = new Date(t.getTime() + i * 2 * 86400000);
    return {
      id: `demo-${i}`,
      title: [
        "Write-up: my agentic RSS pipeline",
        "Discussion: are MCP servers eating zaps?",
        "Question: best chunking for long docs?",
      ][i],
      fireAt: d.toISOString(),
      type: ["build", "discussion", "question"][i],
    };
  });
}

export default function LandingPage() {
  const { data: session } = useApi<SessionStatus>("/api/session");
  const { data: postsData } = useApi<PostsResponse>(
    session?.connected ? "/api/posts" : null,
  );

  const queued = (postsData?.posts ?? [])
    .filter((p) => p.status === "queued" || p.status === "in_progress")
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1))
    .slice(0, 4);

  const railItems: RailItem[] =
    queued.length > 0
      ? queued.map((p) => ({
          id: p.id,
          title: p.title || `(${p.type} post)`,
          fireAt: p.fireAt,
          type: p.type,
        }))
      : demoRail();

  return (
    <AppShell>
      <section className="pt-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold/90">
          free · no backend · built for prmpted.com
        </p>
        <h1 className="mt-4 font-display text-[44px] leading-[1.05] tracking-tight text-cream">
          Post on rhythm.
        </h1>
        <h2 className="font-display text-[26px] italic leading-tight text-gold">
          Your Prompted posts, right on time.
        </h2>
        <p className="mx-auto mt-4 max-w-[38ch] text-[15px] leading-relaxed text-muted">
          Connect your Prompted account, compose builds, discussions, videos and
          questions — then fire them at an exact time or drip them on a cadence.
          A free cron checks in every 5 minutes so nothing needs to stay online.
        </p>

        <div className="mt-6 flex flex-col gap-2.5">
          {session?.connected ? (
            <>
              <LinkPill href="/queue">Open your queue</LinkPill>
              <LinkPill href="/compose" variant="ghost">
                Compose a post
              </LinkPill>
            </>
          ) : (
            <>
              <LinkPill href="/connect">Connect your Prompted account</LinkPill>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted/70">
                no signup — paste one token, that&apos;s the whole login
              </p>
            </>
          )}
        </div>
      </section>

      {/* Signature queue rail */}
      <section className="card mt-10 p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            {queued.length > 0 ? "next up · your queue" : "the queue rail"}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-gold">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold animate-pulse-dot" />
            pulsing = next to fire
          </span>
        </div>
        <QueueRail items={railItems} />
      </section>

      <section className="mt-6 grid gap-3">
        {[
          {
            t: "Exact-time scheduling",
            d: "Pick the minute. The worker checks the clock, refreshes your token if it's stale, and posts for you.",
          },
          {
            t: "Drip queues",
            d: "Drop posts into a batch and Cadence auto-spaces them — every 2 days at 9:00am, or whatever cadence you set.",
          },
          {
            t: "Nothing fails silently",
            d: "Every attempt is logged. Retries back off automatically; if your session goes stale you get one clear reconnect prompt.",
          },
        ].map((f) => (
          <div key={f.t} className="card p-4">
            <h3 className="font-display text-lg text-cream">{f.t}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{f.d}</p>
          </div>
        ))}
      </section>

      <section className="mt-6">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          how it works
        </p>
        <ol className="card divide-y divide-line">
          {[
            "Connect — paste the prompted-auth session from your browser's Local Storage. It's verified live, then encrypted at rest and never shown again.",
            "Compose — every field Prompted's own form has, with live-synced categories, tools, and communities.",
            "Schedule — one exact time, or a drip queue that spaces a whole batch for you.",
            "Fire — cron-job.org pings Cadence every 5 minutes; due posts go out via Prompted's own API, at the exact minute scheduled.",
          ].map((s, i) => (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="font-mono text-xs text-gold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="text-[13px] leading-relaxed text-muted">{s}</p>
            </li>
          ))}
        </ol>
      </section>
    </AppShell>
  );
}
