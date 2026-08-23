"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import AppShell, { useTz } from "@/components/AppShell";
import PreviewFrame from "@/components/PreviewFrame";
import { Countdown, Pill, SectionLabel, Spinner } from "@/components/ui";
import {
  api,
  PostsResponse,
  RefsResponse,
  SessionStatus,
  useApi,
} from "@/lib/client";
import { Post } from "@/lib/types";
import { fmtStamp } from "@/lib/time";

// Preview-as-Prompted: shows exactly how the post will render on prmpted.com
// inside a dashed frame, with an explicit "not yet live" state — then lets
// you schedule, keep editing, or discard.

export default function PreviewPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id as string;

  const { data: postsData, error } = useApi<PostsResponse>(
    id ? "/api/posts" : null,
  );
  const { data: session } = useApi<SessionStatus>("/api/session");
  const { data: refsData } = useApi<RefsResponse>("/api/refs");
  const { zone, abbr } = useTz();

  const post: Post | undefined = postsData?.posts.find((p) => p.id === id);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
      setBusy(null);
    }
  };

  const confirmSchedule = () =>
    act("schedule", async () => {
      await api(`/api/posts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "queued" }),
      });
      router.push("/queue");
    });

  const keepEditing = () => router.push(`/compose?id=${id}`);

  const discard = () =>
    act("discard", async () => {
      await api(`/api/posts/${id}`, { method: "DELETE" });
      router.push("/compose");
    });

  const cancelPost = () =>
    act("cancel", async () => {
      await api(`/api/posts/${id}`, { method: "DELETE" });
      router.push("/queue");
    });

  const retryPost = () =>
    act("retry", async () => {
      await api(`/api/posts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ retry: true }),
      });
      router.push("/queue");
    });

  if (error) {
    return (
      <AppShell>
        <p className="text-sm text-bad">{error}</p>
      </AppShell>
    );
  }

  if (!post) {
    return (
      <AppShell>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading preview…
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <SectionLabel>Preview</SectionLabel>

      <PreviewFrame
        post={post}
        username={session?.username ?? "you"}
        refs={refsData?.refs ?? null}
      />

      {/* scheduling state + actions */}
      <div className="card mt-6 p-4">
        {post.status === "draft" && (
          <>
            <p className="text-center font-mono text-[11px] uppercase tracking-wider text-muted">
              fires {fmtStamp(post.fireAt, zone)}
              {abbr ? ` ${abbr}` : ""}{" "}
              {post.batchId ? "· drip queue" : "· exact time"}
            </p>
            {actionError && (
              <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-xs text-bad">
                {actionError}
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2.5">
              <Pill onClick={confirmSchedule} disabled={busy !== null}>
                {busy === "schedule" ? <Spinner /> : "Looks good — schedule it"}
              </Pill>
              <Pill variant="ghost" onClick={keepEditing} disabled={busy !== null}>
                Keep editing
              </Pill>
              <Pill variant="danger" onClick={discard} disabled={busy !== null}>
                {busy === "discard" ? <Spinner /> : "Discard draft"}
              </Pill>
            </div>
          </>
        )}

        {(post.status === "queued" || post.status === "in_progress") && (
          <>
            <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold animate-pulse-dot" />
              scheduled · {fmtStamp(post.fireAt, zone)}
              {abbr ? ` ${abbr}` : ""} ·{" "}
              <Countdown
                target={post.fireAt}
                className="text-gold"
                pastLabel={post.status === "in_progress" ? "firing…" : "posting"}
              />
            </div>
            {post.attempts > 0 && (
              <p className="mt-2 text-center font-mono text-[10px] text-gold">
                retrying {post.attempts}/3 {post.lastError ? `· ${post.lastError}` : ""}
              </p>
            )}
            {actionError && (
              <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-xs text-bad">
                {actionError}
              </p>
            )}
            <div className="mt-4 flex gap-2.5">
              <Pill variant="ghost" className="flex-1" onClick={keepEditing} disabled={busy !== null}>
                Edit
              </Pill>
              <Pill variant="danger" className="flex-1" onClick={cancelPost} disabled={busy !== null}>
                {busy === "cancel" ? <Spinner /> : "Cancel post"}
              </Pill>
            </div>
          </>
        )}

        {post.status === "posted" && (
          <>
            <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-good">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-good" />
              posted {post.postedAt ? fmtStamp(post.postedAt, zone) : ""}
              {post.postedAt && abbr ? ` ${abbr}` : ""}
            </div>
            <div className="mt-4">
              {post.promptedPostId ? (
                <a
                  href={`https://prmpted.com/post/${post.promptedPostId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full rounded-full bg-gold px-4 py-2.5 text-center text-sm font-semibold text-ink hover:brightness-110"
                >
                  View on Prompted ↗
                </a>
              ) : (
                <Link
                  href="/queue"
                  className="block w-full rounded-full border border-line px-4 py-2.5 text-center text-sm text-cream hover:border-gold/50 hover:text-gold"
                >
                  Back to queue
                </Link>
              )}
            </div>
          </>
        )}

        {post.status === "failed" && (
          <>
            <div className="flex items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-wider text-bad">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-bad" />
              failed after {post.attempts}/3 attempts
            </div>
            {post.lastError && (
              <p className="mt-2 text-center font-mono text-[10px] text-muted">
                {post.lastError}
              </p>
            )}
            {actionError && (
              <p className="mt-3 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-xs text-bad">
                {actionError}
              </p>
            )}
            <div className="mt-4 flex gap-2.5">
              <Pill className="flex-1" onClick={retryPost} disabled={busy !== null}>
                {busy === "retry" ? <Spinner /> : "Retry"}
              </Pill>
              {session?.needsReconnect && (
                <Link
                  href="/connect"
                  className="flex-1 rounded-full border border-bad/40 px-4 py-2.5 text-center text-sm text-bad hover:bg-bad/10"
                >
                  Reconnect
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
