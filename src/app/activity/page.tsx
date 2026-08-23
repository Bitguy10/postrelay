"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell, { useTz } from "@/components/AppShell";
import { Empty, SectionLabel, StatusDot } from "@/components/ui";
import { ActivityResponse, api, useApi } from "@/lib/client";
import { dayLabel, fmtTime } from "@/lib/time";

type Filter = "all" | "posted" | "retrying" | "failed";

// Activity log — the other data-dense screen: widens at ≥900px so Today sits
// beside Yesterday-and-earlier.

export default function ActivityPage() {
  const { data, refresh } = useApi<ActivityResponse>("/api/activity", {
    refreshMs: 30000,
  });
  const { zone, abbr } = useTz();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const entries = (data?.entries ?? []).filter((e) =>
    filter === "all" ? true : e.status === filter,
  );

  const groups = useMemo(() => {
    const byDay = new Map<string, typeof entries>();
    for (const e of entries) {
      const label = dayLabel(e.at, zone);
      if (!byDay.has(label)) byDay.set(label, []);
      byDay.get(label)!.push(e);
    }
    return Array.from(byDay.entries());
  }, [entries, zone]);

  const retry = async (postId: string) => {
    setBusyId(postId);
    try {
      await api(`/api/posts/${postId}`, {
        method: "PATCH",
        body: JSON.stringify({ retry: true }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const stats = data?.stats;

  return (
    <AppShell wide>
      <SectionLabel>Activity</SectionLabel>

      {/* reconnect banner */}
      {data?.needsReconnect && (
        <div className="card mb-4 flex items-center justify-between gap-3 border-bad/30 bg-bad/5 px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold text-bad">Session can&apos;t be refreshed.</span>{" "}
            <span className="text-muted">
              Scheduled posts are held — reconnect to resume firing.
            </span>
          </div>
          <Link
            href="/connect"
            className="shrink-0 rounded-full bg-bad/90 px-4 py-1.5 font-mono text-[11px] font-semibold uppercase text-ink hover:bg-bad"
          >
            Reconnect
          </Link>
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="card px-4 py-3.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">posted</p>
          <p className="mt-1 font-display text-2xl text-good">{stats?.posted ?? 0}</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">success rate</p>
          <p className="mt-1 font-display text-2xl text-cream">{stats?.successRate ?? 100}%</p>
        </div>
        <div className="card px-4 py-3.5">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">retrying</p>
          <p className={`mt-1 font-display text-2xl ${stats?.retrying ? "text-gold animate-pulse-dot" : "text-cream"}`}>
            {stats?.retrying ?? 0}
          </p>
        </div>
      </div>

      {/* filters */}
      <div className="mt-5 flex flex-wrap gap-2">
        {(["all", "posted", "retrying", "failed"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              filter === f
                ? "border-gold/60 bg-gold/10 text-gold"
                : "border-line text-muted hover:text-cream"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* date-grouped history, two columns ≥900px */}
      {entries.length === 0 ? (
        <div className="mt-5">
          <Empty>Nothing logged yet. Attempts appear here the moment the cron fires.</Empty>
        </div>
      ) : (
        <div className="mt-5 grid gap-8 min-[900px]:grid-cols-2 min-[900px]:items-start">
          {groups.map(([label, rows]) => (
            <section key={label}>
              <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                {label}
                {abbr ? <span className="ml-1.5 text-muted/60">{abbr}</span> : null}
              </p>
              <div className="space-y-2">
                {rows.map((e) => (
                  <div key={e.id} className="card px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={e.status} />
                      <span className="tag text-muted">{e.postType}</span>
                      <Link
                        href={`/preview/${e.postId}`}
                        className="min-w-0 flex-1 truncate text-sm text-cream hover:text-gold"
                      >
                        {e.title || `(${e.postType} post)`}
                      </Link>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {fmtTime(e.at, zone)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[16px]">
                      {e.status === "retrying" && (
                        <span className="rounded-md bg-gold/15 px-2 py-0.5 font-mono text-[10px] text-gold">
                          {e.attempts}/3 · backing off
                        </span>
                      )}
                      {e.status === "failed" && (
                        <>
                          <span className="rounded-md bg-bad/10 px-2 py-0.5 font-mono text-[10px] text-bad">
                            failed after {e.attempts}/3
                          </span>
                          {e.reason && (
                            <span className="max-w-full truncate font-mono text-[10px] text-muted">
                              {e.reason}
                            </span>
                          )}
                          {e.authFailure ? (
                            <Link
                              href="/connect"
                              className="rounded-full border border-bad/40 px-3 py-1 font-mono text-[10px] uppercase text-bad hover:bg-bad/10"
                            >
                              Reconnect
                            </Link>
                          ) : (
                            <button
                              onClick={() => retry(e.postId)}
                              disabled={busyId === e.postId}
                              className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase text-muted hover:border-gold/50 hover:text-gold disabled:opacity-50"
                            >
                              Retry now
                            </button>
                          )}
                        </>
                      )}
                      {e.status === "posted" && !e.authFailure && (
                        <span className="font-mono text-[10px] text-good/70">
                          attempt {e.attempts} ✓
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}
