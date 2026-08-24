"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AppShell from "@/components/AppShell";
import TimezonePicker from "@/components/TimezonePicker";
import { Pill, SectionLabel, Spinner } from "@/components/ui";
import {
  api,
  BatchesResponse,
  PostsResponse,
  SessionStatus,
  useApi,
} from "@/lib/client";
import { parsePastedSession } from "@/lib/validate";
import { resolveZone, zoneAbbr } from "@/lib/time";

function StepNum({ n, done }: { n: number; done?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
        done
          ? "border-good/50 bg-good/15 text-good"
          : "border-gold/50 bg-gold/10 text-gold"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}

export default function ConnectPage() {
  const { data: session, refresh } = useApi<SessionStatus>("/api/session");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedAs, setConnectedAs] = useState<string | null>(null);

  // Auto-detected IANA zone from the browser (never a fixed offset).
  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);
  const [tzOverride, setTzOverride] = useState<string | null>(null);

  // Timezone settings (connected): change flow + reinterpret choice
  const [tzBusy, setTzBusy] = useState(false);
  const [pendingZone, setPendingZone] = useState<string | null>(null);
  const [choiceCounts, setChoiceCounts] = useState<{
    posts: number;
    batches: number;
  } | null>(null);
  const [tzMsg, setTzMsg] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!pasted.trim()) return null;
    return parsePastedSession(pasted);
  }, [pasted]);

  const connected = connectedAs ?? (session?.connected ? session.username : null);
  const showDone = Boolean(connected);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ connected: true; username: string }>(
        "/api/session",
        {
          method: "POST",
          body: JSON.stringify({
            sessionJson: pasted,
            timezone: tzOverride ?? detectedTz,
          }),
        },
      );
      setConnectedAs(res.username);
      setPasted("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await api("/api/session", { method: "DELETE" });
    setConnectedAs(null);
    await refresh();
  };

  const applyZone = async (z: string) => {
    setTzMsg(null);
    if (z === session?.timezone) {
      setPendingZone(null);
      setChoiceCounts(null);
      return;
    }
    setTzBusy(true);
    try {
      // Anything not-yet-fired? Then the shift-vs-keep question must be asked.
      const [postsRes, batchesRes] = await Promise.all([
        api<PostsResponse>("/api/posts"),
        api<BatchesResponse>("/api/batches"),
      ]);
      const pending = postsRes.posts.filter((p) =>
        ["queued", "in_progress", "draft"].includes(p.status),
      ).length;
      const rules = batchesRes.batches.length;
      if (pending > 0 || rules > 0) {
        setPendingZone(z);
        setChoiceCounts({ posts: pending, batches: rules });
      } else {
        await confirmZone(z, undefined);
      }
    } catch (e) {
      setTzMsg(e instanceof Error ? e.message : "Could not check the queue");
    } finally {
      setTzBusy(false);
    }
  };

  const confirmZone = async (
    z: string,
    reinterpret: "shift" | "keep" | undefined,
  ) => {
    setTzBusy(true);
    try {
      const res = await api<{ shiftedPosts?: number }>("/api/session", {
        method: "PATCH",
        body: JSON.stringify({ timezone: z, ...(reinterpret ? { reinterpret } : {}) }),
      });
      setTzMsg(
        reinterpret === "shift"
          ? `Done — ${res.shiftedPosts ?? 0} queued post(s) now fire at the same local time in ${z.replace(/_/g, " ")}.`
          : reinterpret === "keep"
            ? "Done — existing posts keep their exact scheduled moments."
            : `Timezone set to ${z.replace(/_/g, " ")}.`,
      );
      setPendingZone(null);
      setChoiceCounts(null);
      await refresh();
    } catch (e) {
      setTzMsg(e instanceof Error ? e.message : "Could not change timezone");
    } finally {
      setTzBusy(false);
    }
  };

  return (
    <AppShell>
      <SectionLabel>Connect account</SectionLabel>
      <h1 className="font-display text-3xl leading-tight text-cream">
        One token,{" "}
        <span className="italic text-gold">that&apos;s the whole login.</span>
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        PostRelay has no accounts of its own. You paste the session Prompted
        already gave your browser; it&apos;s verified live, encrypted at rest,
        and never displayed again.
      </p>

      {/* config warnings */}
      {session && !session.config.redis && (
        <p className="mt-4 rounded-xl border border-gold/30 bg-gold/5 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-gold/90">
          Upstash Redis env vars missing — running on the in-memory dev store.
          Data resets when the server restarts.
        </p>
      )}
      {session && !session.config.encryptionKey && (
        <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 font-mono text-[11px] text-bad">
          CADENCE_ENCRYPTION_KEY is not set — tokens can&apos;t be encrypted.
        </p>
      )}

      {/* STEP 1 */}
      <div className="card mt-6 p-4">
        <div className="flex items-center gap-3">
          <StepNum n={1} done={showDone} />
          <h2 className="text-sm font-semibold text-cream">
            Copy your session from Prompted
          </h2>
        </div>
        <ol className="mt-3 space-y-1.5 pl-9 text-[13px] leading-relaxed text-muted">
          <li>
            Open{" "}
            <a href="https://prmpted.com" target="_blank" rel="noreferrer" className="text-gold underline underline-offset-2">
              prmpted.com
            </a>{" "}
            and log in as usual.
          </li>
          <li>
            Press <span className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-cream">F12</span> →{" "}
            <span className="text-cream">Application</span> →{" "}
            <span className="text-cream">Local Storage</span> →{" "}
            <span className="text-cream">prmpted.com</span>.
          </li>
          <li>
            Find the key{" "}
            <span className="rounded bg-panel2 px-1.5 py-0.5 font-mono text-[11px] text-gold">prompted-auth</span>{" "}
            — Prompted stores auth as a Supabase session object, not a cookie.
          </li>
          <li>
            Double-click the <span className="text-cream">value</span> and copy
            the whole JSON.
          </li>
        </ol>
      </div>

      {/* STEP 2 */}
      <div className="card mt-4 p-4">
        <div className="flex items-center gap-3">
          <StepNum n={2} done={showDone} />
          <h2 className="text-sm font-semibold text-cream">Paste & verify</h2>
        </div>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          spellCheck={false}
          placeholder={`{"access_token":"eyJ…","refresh_token":"…","expires_at":…,"user":{…}}`}
          className="field mt-3 min-h-[110px] font-mono text-[11px] leading-relaxed"
        />

        {parsed && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {parsed.ok ? (
              <>
                <span className="chip border-good/40 text-good">access_token ✓</span>
                <span className="chip border-good/40 text-good">refresh_token ✓</span>
                {parsed.session.expires_at && (
                  <span className="chip">
                    expires {new Date(parsed.session.expires_at * 1000).toLocaleDateString()}
                  </span>
                )}
                {parsed.session.user?.email && (
                  <span className="chip">{parsed.session.user.email}</span>
                )}
              </>
            ) : (
              <span className="chip border-bad/40 text-bad">{parsed.error}</span>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-xs leading-relaxed text-bad">
            {error}
          </p>
        )}

        <Pill
          className="mt-4 w-full"
          disabled={busy || !parsed?.ok}
          onClick={connect}
        >
          {busy ? (
            <>
              <Spinner /> Verifying against Prompted…
            </>
          ) : (
            "Verify & connect"
          )}
        </Pill>
        <p className="mt-2 text-center font-mono text-[10px] text-muted/60">
          verified live · encrypted with AES-256-GCM · never shown again
        </p>

        {/* timezone that will be saved with the connection */}
        <div className="mt-4 border-t border-line pt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
            detected: {resolveZone(detectedTz).replace(/_/g, " ")} (
            {zoneAbbr(detectedTz)})
          </p>
          <div className="mt-2">
            <TimezonePicker
              value={tzOverride ?? detectedTz}
              detected={detectedTz}
              onApply={(z) => setTzOverride(z)}
            />
          </div>
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted/60">
            all times you set and see use this zone — change it any time after
            connecting too
          </p>
        </div>
      </div>

      {/* STEP 3 */}
      <div className={`card mt-4 p-4 ${showDone ? "border-good/40" : "opacity-50"}`}>
        <div className="flex items-center gap-3">
          <StepNum n={3} done={showDone} />
          <h2 className="text-sm font-semibold text-cream">
            {showDone ? "Connected" : "Confirmation"}
          </h2>
        </div>
        {showDone ? (
          <div className="mt-3">
            <div className="flex items-center gap-2.5 rounded-xl border border-good/30 bg-good/5 px-4 py-3">
              <span className="inline-block h-2 w-2 rounded-full bg-good" />
              <div>
                <p className="text-sm font-semibold text-good">
                  Connected as @{connected}
                </p>
                {session?.email && (
                  <p className="font-mono text-[10px] text-muted">{session.email}</p>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              PostRelay will refresh this token automatically before each post.
              If it ever goes stale, you&apos;ll see one reconnect prompt —
              nothing fails silently.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href="/compose"
                className="flex-1 rounded-full bg-gold px-4 py-2.5 text-center text-sm font-semibold text-ink hover:brightness-110"
              >
                Compose a post
              </Link>
              <Pill variant="danger" onClick={disconnect}>
                Disconnect
              </Pill>
            </div>
          </div>
        ) : (
          <p className="mt-2 pl-9 text-[13px] text-muted">
            You&apos;ll see “Connected as @username” here.
          </p>
        )}
      </div>

      {/* TIMEZONE SETTINGS — only meaningful once connected */}
      {showDone && (
        <div className="card mt-4 p-4">
          <SectionLabel>Timezone</SectionLabel>
          <p className="text-sm text-cream">
            {session?.timezone
              ? resolveZone(session.timezone).replace(/_/g, " ")
              : "—"}
            {session?.tzAbbr ? (
              <span className="text-muted"> ({session.tzAbbr})</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Times you set on compose and every countdown/log timestamp use this
            zone. Scheduled moments are stored as absolute instants and fired
            on time no matter what zone they were set in.
          </p>

          <div className="mt-3">
            <TimezonePicker
              value={session?.timezone ?? detectedTz}
              detected={detectedTz}
              busy={tzBusy}
              onApply={applyZone}
            />
          </div>

          {/* shift-or-keep choice — never silently picked */}
          {pendingZone && choiceCounts && (
            <div className="mt-3 rounded-xl border border-gold/40 bg-gold/5 p-3.5">
              <p className="text-sm font-semibold text-gold">
                Before we switch you to {pendingZone.replace(/_/g, " ")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                You have {choiceCounts.posts} not-yet-fired post(s) and{" "}
                {choiceCounts.batches} drip rule(s). Should they follow the new
                timezone or keep their exact scheduled moments?
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  disabled={tzBusy}
                  onClick={() => confirmZone(pendingZone, "shift")}
                  className="rounded-full bg-gold px-4 py-2 text-left text-xs font-semibold text-ink disabled:opacity-50"
                >
                  Shift to {pendingZone.replace(/_/g, " ")} — a post set for
                  9:00 AM stays 9:00 AM local
                </button>
                <button
                  disabled={tzBusy}
                  onClick={() => confirmZone(pendingZone, "keep")}
                  className="rounded-full border border-line px-4 py-2 text-left text-xs text-cream hover:border-gold/50 disabled:opacity-50"
                >
                  Keep absolute times — posts fire at the exact moment already
                  scheduled
                </button>
              </div>
            </div>
          )}

          {tzBusy && (
            <p className="mt-2 flex items-center gap-2 font-mono text-[10px] text-muted">
              <Spinner className="h-3 w-3" /> working…
            </p>
          )}
          {tzMsg && (
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-good">
              {tzMsg}
            </p>
          )}
          {session?.tzFallback && (
            <p className="mt-2 font-mono text-[10px] leading-relaxed text-gold">
              saved zone was invalid — showing UTC until you set one above
            </p>
          )}
        </div>
      )}

      {session?.needsReconnect && (
        <p className="mt-4 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
          Your saved session can&apos;t be refreshed. Paste a fresh token above
          to reconnect — scheduled posts are held until then.
        </p>
      )}
    </AppShell>
  );
}
