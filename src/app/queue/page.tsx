"use client";

import Link from "next/link";
import { useState } from "react";
import AppShell, { useTz } from "@/components/AppShell";
import { Countdown, Empty, SectionLabel, Spinner, StatusDot } from "@/components/ui";
import { api, BatchesResponse, PostsResponse, useApi } from "@/lib/client";
import { fmtStamp, zoneAbbr } from "@/lib/time";

// Queue dashboard — the data-dense screen: widens to two columns at ≥900px
// (drip batches beside the upcoming queue). All times render in the
// connected user's timezone; each drip rule shows its own zone abbreviation.

function Stat({
  label,
  children,
  pulse,
}: {
  label: string;
  children: React.ReactNode;
  pulse?: boolean;
}) {
  return (
    <div className={`card px-4 py-3.5 ${pulse ? "border-gold/40" : ""}`}>
      <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
        {label}
      </p>
      <div className={`mt-1 ${pulse ? "animate-pulse-dot" : ""}`}>{children}</div>
    </div>
  );
}

export default function QueuePage() {
  const postsApi = useApi<PostsResponse>("/api/posts", { refreshMs: 30000 });
  const batchesApi = useApi<BatchesResponse>("/api/batches", { refreshMs: 30000 });
  const { zone, abbr } = useTz();
  const [editingBatch, setEditingBatch] = useState<string | null>(null);
  const [editInterval, setEditInterval] = useState(2);
  const [editTime, setEditTime] = useState("09:00");
  const [busyId, setBusyId] = useState<string | null>(null);

  const posts = postsApi.data?.posts ?? [];
  const batches = batchesApi.data?.batches ?? [];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  const upcoming = posts
    .filter((p) => p.status === "queued" || p.status === "in_progress")
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));
  const nextFire = upcoming[0];
  const activeBatchCount = batches.filter((b) => b.status === "active").length;

  const cancel = async (id: string) => {
    if (!confirm("Cancel this scheduled post?")) return;
    setBusyId(id);
    try {
      await api(`/api/posts/${id}`, { method: "DELETE" });
      await Promise.all([postsApi.refresh(), batchesApi.refresh()]);
    } catch {
      // surfaced by refresh
    } finally {
      setBusyId(null);
    }
  };

  const toggleBatch = async (id: string, current: string) => {
    setBusyId(id);
    try {
      await api(`/api/batches/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: current === "active" ? "paused" : "active" }),
      });
      await batchesApi.refresh();
    } finally {
      setBusyId(null);
    }
  };

  const startEditCadence = (id: string, interval: number, time: string) => {
    setEditingBatch(id);
    setEditInterval(interval);
    setEditTime(time);
  };

  const saveCadence = async (id: string) => {
    setBusyId(id);
    try {
      await api(`/api/batches/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ intervalDays: editInterval, timeOfDay: editTime }),
      });
      setEditingBatch(null);
      await Promise.all([batchesApi.refresh(), postsApi.refresh()]);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell wide>
      <SectionLabel>Queue</SectionLabel>

      {/* stat strip */}
      <div className="grid grid-cols-3 gap-2.5">
        <Stat label="scheduled">
          <span className="font-display text-2xl text-cream">{upcoming.length}</span>
        </Stat>
        <Stat label="next fire" pulse={Boolean(nextFire)}>
          {nextFire ? (
            <Countdown target={nextFire.fireAt} className="block text-gold" />
          ) : (
            <span className="font-mono text-xs text-muted">—</span>
          )}
        </Stat>
        <Stat label="active batches">
          <span className="font-display text-2xl text-cream">{activeBatchCount}</span>
        </Stat>
      </div>

      {/* two columns ≥900px: batches | upcoming */}
      <div className="mt-6 grid gap-8 min-[900px]:grid-cols-2 min-[900px]:items-start">
        {/* drip batches */}
        <section>
          <SectionLabel>Drip batches</SectionLabel>
          {batches.length === 0 && (
            <Empty>
              No drip batches yet. Compose a post and choose{" "}
              <span className="text-cream">Drip queue</span> to start one.
            </Empty>
          )}
          <div className="space-y-3">
            {batches.map((b) => {
              const pct =
                b.counts.total === 0
                  ? 0
                  : Math.round((b.counts.posted / b.counts.total) * 100);
              const bAbbr = zoneAbbr(b.timezone);
              return (
                <div key={b.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-cream">
                        Every {b.intervalDays === 1 ? "day" : `${b.intervalDays} days`} · {b.timeOfDay}
                        {bAbbr && (
                          <span className="ml-1.5 font-mono text-[10px] font-normal text-gold/80">
                            {bAbbr}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted">
                        next open slot {fmtStamp(b.nextSlot, zone)}
                        {bAbbr ? ` ${bAbbr}` : ""}
                      </p>
                    </div>
                    <span
                      className={`tag ${
                        b.status === "active" ? "border-good/40 text-good" : "border-line text-muted"
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>

                  {/* progress */}
                  <div className="mt-3">
                    <div className="flex justify-between font-mono text-[10px] text-muted">
                      <span>
                        {b.counts.posted}/{b.counts.total} posted
                      </span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2">
                      <div
                        className="h-full rounded-full bg-good transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* actions */}
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleBatch(b.id, b.status)}
                      disabled={busyId === b.id}
                      className="rounded-full border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-gold/50 hover:text-gold disabled:opacity-50"
                    >
                      {b.status === "active" ? "Pause" : "Resume"}
                    </button>
                    {editingBatch === b.id ? (
                      <span className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={editInterval}
                          onChange={(e) =>
                            setEditInterval(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                          }
                          className="field w-14 px-2 py-1 text-center text-xs"
                        />
                        <input
                          type="time"
                          value={editTime}
                          onChange={(e) => setEditTime(e.target.value)}
                          className="field w-24 px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => saveCadence(b.id)}
                          disabled={busyId === b.id}
                          className="rounded-full bg-gold px-3 py-1.5 font-mono text-[10px] font-semibold uppercase text-ink"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => setEditingBatch(null)}
                          className="rounded-full border border-line px-3 py-1.5 font-mono text-[10px] uppercase text-muted"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => startEditCadence(b.id, b.intervalDays, b.timeOfDay)}
                        className="rounded-full border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-gold/50 hover:text-gold"
                      >
                        Edit cadence
                      </button>
                    )}
                  </div>

                  {editingBatch === b.id && (
                    <p className="mt-2 font-mono text-[10px] text-muted/60">
                      re-spaces not-yet-fired posts from the next slot
                    </p>
                  )}

                  {/* posts in batch */}
                  {b.posts.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wider text-muted hover:text-gold">
                        view posts ({b.posts.length})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {b.posts.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2"
                          >
                            <StatusDot status={p.status} />
                            <Link href={`/preview/${p.id}`} className="min-w-0 flex-1 truncate text-xs text-cream hover:text-gold">
                              {p.title || `(${p.type} post)`}
                            </Link>
                            <span className="font-mono text-[10px] text-muted">
                              {fmtStamp(p.fireAt, zone)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* upcoming queue */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
              Upcoming
            </span>
            {abbr && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted/70">
                times in {abbr}
              </span>
            )}
          </div>
          {upcoming.length === 0 && (
            <Empty>
              Nothing scheduled. Hit{" "}
              <span className="text-gold">+</span> to compose your first post.
            </Empty>
          )}
          <div className="space-y-2.5">
            {upcoming.map((p, i) => {
              const isNext = i === 0;
              const batch = p.batchId ? batchById.get(p.batchId) : null;
              return (
                <div
                  key={p.id}
                  className={`card flex items-center gap-3 px-4 py-3 ${
                    isNext ? "border-gold/50" : ""
                  }`}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      isNext ? "bg-gold animate-pulse-dot" : "bg-gold/40"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="tag text-muted">{p.type}</span>
                      {batch && (
                        <span className="tag border-gold/30 text-gold/80">drip</span>
                      )}
                      {p.status === "in_progress" && (
                        <span className="tag border-gold/50 text-gold">firing</span>
                      )}
                    </div>
                    <Link
                      href={`/preview/${p.id}`}
                      className="mt-1 block truncate text-sm text-cream hover:text-gold"
                    >
                      {p.title || `(${p.type} post)`}
                    </Link>
                    <p className="font-mono text-[10px] text-muted">
                      {fmtStamp(p.fireAt, zone)} · <Countdown target={p.fireAt} className="text-gold/80" />
                      {p.attempts > 0 && (
                        <span className="text-gold"> · retry {p.attempts}/3</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Link
                      href={`/compose?id=${p.id}`}
                      className="font-mono text-[10px] uppercase text-muted hover:text-gold"
                    >
                      edit
                    </Link>
                    <button
                      onClick={() => cancel(p.id)}
                      disabled={busyId === p.id}
                      className="font-mono text-[10px] uppercase text-muted hover:text-bad disabled:opacity-50"
                    >
                      {busyId === p.id ? <Spinner className="h-3 w-3" /> : "cancel"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* floating compose button */}
      <Link
        href="/compose"
        aria-label="Compose a post"
        className="fixed bottom-6 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-2xl font-light text-ink shadow-lg shadow-gold/20 transition-transform hover:scale-105 active:scale-95 min-[900px]:right-[max(1.25rem,calc(50vw_-_450px_+_1.25rem))]"
      >
        +
      </Link>
    </AppShell>
  );
}
