"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import AppShell, { useTz } from "@/components/AppShell";
import PostForm from "@/components/PostForm";
import { Pill, SectionLabel, Spinner } from "@/components/ui";
import {
  api,
  BatchesResponse,
  PostsResponse,
  RefsResponse,
  useApi,
} from "@/lib/client";
import { Post, PostType } from "@/lib/types";
import {
  fmtStamp,
  localInputToUtcIso,
  resolveZone,
  utcToLocalInput,
  zoneAbbr,
} from "@/lib/time";
import { requiredMissing } from "@/lib/validate";

const TYPES: {
  type: PostType;
  name: string;
  blurb: string;
  icon: string;
}[] = [
  { type: "build", name: "Build", blurb: "Ship a project, prompt included", icon: "◆" },
  { type: "discussion", name: "Discussion", blurb: "Start a conversation, maybe a poll", icon: "◇" },
  { type: "video", name: "Video", blurb: "Drop a demo with topics", icon: "▷" },
  { type: "question", name: "Question", blurb: "Ask the community", icon: "?" },
];

function newPost(type: PostType): Post {
  return {
    id: "",
    type,
    status: "draft",
    fireAt: "",
    createdAt: "",
    batchId: null,
    title: "",
    body: "",
    promptSteps: type === "build" ? [{ step_number: 1, prompt_text: "" }] : [],
    link: "",
    githubUrl: "",
    remixUrl: "",
    difficulty: undefined,
    pollEnabled: false,
    pollOptions: ["", ""],
    categoryIds: [],
    toolNames: [],
    communityIds: [],
    media: [],
    video: null,
    designDoc: null,
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    postedAt: null,
    lockedAt: null,
  };
}

function defaultSingleAt(zone: string): string {
  // next ~hour in the user's own zone, rounded to a clean 5 minutes
  const next = DateTime.now().setZone(resolveZone(zone)).plus({ hours: 1 });
  return next
    .set({
      minute: Math.ceil(next.minute / 5) * 5,
      second: 0,
      millisecond: 0,
    })
    .toFormat("yyyy-LL-dd'T'HH:mm");
}

export default function ComposePage() {
  const router = useRouter();
  const { zone: contextZone, abbr } = useTz();
  // Times are entered & interpreted in the connected user's stored zone;
  // before that's known, fall back to the browser's own IANA zone.
  const zone = useMemo(() => resolveZone(contextZone), [contextZone]);
  const { data: refsData } = useApi<RefsResponse>("/api/refs");
  const { data: batchesData } = useApi<BatchesResponse>("/api/batches");

  const [editingId, setEditingId] = useState<string | null>(null);
  const loadedEdit = useRef(false);
  const [post, setPost] = useState<Post>(() => newPost("build"));
  const [mode, setMode] = useState<"single" | "drip">("single");
  const [singleAt, setSingleAt] = useState(() => defaultSingleAt(zone));
  // re-anchor the default time once the real (stored) zone arrives
  const zoneLocked = useRef(false);
  useEffect(() => {
    if (!zoneLocked.current && contextZone !== "system") {
      zoneLocked.current = true;
      if (!editingId) setSingleAt(defaultSingleAt(zone));
    }
  }, [contextZone, zone, editingId]);
  const [dripChoice, setDripChoice] = useState<string>("new");
  const [newInterval, setNewInterval] = useState(2);
  const [newTime, setNewTime] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only re-send the schedule when the user actually touched it — editing
  // content must not silently re-slot a drip post.
  const [scheduleDirty, setScheduleDirty] = useState(false);

  // /compose?id=<postId> → edit an existing (draft or queued) post
  const { data: postsData } = useApi<PostsResponse>(editingId ? "/api/posts" : null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setEditingId(id);
  }, []);

  const editingPost = useMemo(
    () => (editingId ? postsData?.posts.find((p) => p.id === editingId) ?? null : null),
    [editingId, postsData],
  );
  useEffect(() => {
    if (editingPost && !loadedEdit.current) {
      loadedEdit.current = true;
      setPost(editingPost);
      setMode(editingPost.batchId ? "drip" : "single");
      if (!editingPost.batchId) setSingleAt(utcToLocalInput(editingPost.fireAt, zone));
      else setDripChoice(editingPost.batchId);
    }
  }, [editingPost, zone]);
  useEffect(() => {
    if (editingId && postsData && !editingPost && !loadedEdit.current) {
      loadedEdit.current = true;
      setError("That post doesn't exist anymore.");
    }
  }, [editingId, postsData, editingPost]);

  const patch = (p: Partial<Post>) => setPost((cur) => ({ ...cur, ...p }));

  const touchSchedule = <T,>(setter: (v: T) => void) => (v: T) => {
    setScheduleDirty(true);
    setter(v);
  };
  const setModeT = touchSchedule(setMode);
  const setSingleAtT = touchSchedule(setSingleAt);
  const setDripChoiceT = touchSchedule(setDripChoice);
  const setNewIntervalT = touchSchedule(setNewInterval);
  const setNewTimeT = touchSchedule(setNewTime);

  const switchType = (type: PostType) => {
    setPost((cur) => ({
      ...newPost(type),
      // keep generally-applicable content when switching
      title: cur.title,
      body: cur.body,
      categoryIds: cur.categoryIds,
      toolNames: cur.toolNames,
      communityIds: type === "video" ? [] : cur.communityIds,
      media: type === "video" ? [] : cur.media,
      remixUrl: cur.remixUrl,
      link: cur.link,
    }));
  };

  const activeBatches = (batchesData?.batches ?? []).filter(
    (b) => b.status === "active",
  );
  const missing = requiredMissing(post);

  const scheduleBody = () =>
    mode === "single"
      ? { mode: "single" as const, at: localInputToUtcIso(singleAt, zone) }
      : dripChoice === "new"
        ? {
            mode: "drip" as const,
            newBatch: {
              intervalDays: newInterval,
              timeOfDay: newTime,
              timezone: zone,
            },
          }
        : { mode: "drip" as const, batchId: dripChoice };

  const contentBody = () => ({
    type: post.type,
    title: post.title,
    body: post.body,
    promptSteps: post.promptSteps,
    link: post.link || undefined,
    githubUrl: post.githubUrl || undefined,
    remixUrl: post.remixUrl || undefined,
    difficulty: post.difficulty,
    pollEnabled: post.pollEnabled,
    pollOptions: post.pollOptions,
    categoryIds: post.categoryIds,
    toolNames: post.toolNames,
    communityIds: post.communityIds,
    media: post.media,
    video: post.video,
    designDoc: post.designDoc,
  });

  const save = async (preview: boolean) => {
    setBusy(true);
    setError(null);
    if (mode === "single" && !localInputToUtcIso(singleAt, zone)) {
      setError("That date/time doesn't parse — check the field and try again.");
      setBusy(false);
      return;
    }
    try {
      if (editingId) {
        const res = await api<{ post: Post }>(`/api/posts/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...contentBody(),
            ...(scheduleDirty ? { schedule: scheduleBody() } : {}),
          }),
        });
        router.push(preview ? `/preview/${res.post.id}` : "/queue");
      } else {
        const res = await api<{ post: Post }>("/api/posts", {
          method: "POST",
          body: JSON.stringify({
            ...contentBody(),
            preview,
            schedule: scheduleBody(),
          }),
        });
        router.push(preview ? `/preview/${res.post.id}` : "/queue");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <SectionLabel>{editingId ? "Edit post" : "Compose"}</SectionLabel>

      {/* type selector — full-width cards */}
      <div className="grid gap-2.5">
        {TYPES.map((t) => {
          const active = post.type === t.type;
          return (
            <button
              key={t.type}
              onClick={() => switchType(t.type)}
              className={`card flex items-center gap-3.5 px-4 py-3.5 text-left transition-all ${
                active
                  ? "border-gold/60 bg-gold/[0.06]"
                  : "hover:border-muted/40"
              }`}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl border text-base ${
                  active ? "border-gold/50 text-gold" : "border-line text-muted"
                }`}
              >
                {t.icon}
              </span>
              <span>
                <span className={`block text-sm font-semibold ${active ? "text-gold" : "text-cream"}`}>
                  {t.name}
                </span>
                <span className="block text-xs text-muted">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* fields */}
      <div className="card mt-5 p-4">
        <PostForm post={post} patch={patch} refs={refsData?.refs ?? null} />
      </div>

      {/* schedule */}
      <div className="card mt-5 p-4">
        <SectionLabel>Schedule</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["single", "Exact time"],
              ["drip", "Drip queue"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setModeT(m)}
              className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                mode === m
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-line text-muted hover:text-cream"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                className="field flex-1"
                value={singleAt}
                min={utcToLocalInput(new Date().toISOString(), zone)}
                onChange={(e) => setSingleAtT(e.target.value)}
              />
              {abbr && (
                <span className="shrink-0 rounded-lg border border-line bg-panel2 px-2.5 py-2 font-mono text-[10px] text-gold">
                  {abbr}
                </span>
              )}
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-muted/60">
              your local time · fires at the exact minute · checked every 5 minutes by the cron
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {activeBatches.map((b) => {
              const chosen = dripChoice === b.id;
              const bAbbr = zoneAbbr(b.timezone);
              return (
                <button
                  key={b.id}
                  onClick={() => setDripChoiceT(b.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                    chosen ? "border-gold/60 bg-gold/10" : "border-line hover:border-muted/40"
                  }`}
                >
                  <span>
                    <span className="block text-sm text-cream">
                      Every {b.intervalDays === 1 ? "day" : `${b.intervalDays} days`} · {b.timeOfDay}
                      {bAbbr ? ` ${bAbbr}` : ""}
                    </span>
                    <span className="block font-mono text-[10px] text-muted">
                      next open slot {fmtStamp(b.nextSlot, zone)} · position #{b.counts.queued + 1}
                    </span>
                  </span>
                  {chosen && <span className="text-gold">●</span>}
                </button>
              );
            })}

            {/* new batch */}
            <button
              onClick={() => setDripChoiceT("new")}
              className={`flex w-full items-center gap-2 rounded-xl border border-dashed px-3.5 py-2.5 text-left transition-colors ${
                dripChoice === "new"
                  ? "border-gold/60 bg-gold/10 text-gold"
                  : "border-line text-muted hover:border-gold/40"
              }`}
            >
              + New drip batch
            </button>
            {dripChoice === "new" && (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-panel2 p-3">
                <span className="text-sm text-muted">every</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={newInterval}
                  onChange={(e) =>
                    setNewIntervalT(Math.max(1, Math.min(30, Number(e.target.value) || 1)))
                  }
                  className="field w-16 text-center"
                />
                <span className="text-sm text-muted">days at</span>
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTimeT(e.target.value)}
                  className="field w-28"
                />
                {abbr && (
                  <span className="font-mono text-[10px] text-gold">{abbr}</span>
                )}
              </div>
            )}
            <p className="font-mono text-[10px] text-muted/60">
              the queue auto-spaces posts · anchored to local time, DST-safe · first slot = next occurrence of that time
            </p>
          </div>
        )}
      </div>

      {/* errors + missing */}
      {error && (
        <p className="mt-4 rounded-xl border border-bad/30 bg-bad/5 px-3.5 py-2.5 text-xs leading-relaxed text-bad">
          {error}
        </p>
      )}
      {!editingId && missing.length > 0 && (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-muted/70">
          still needed to schedule: {missing.join(" · ")}
        </p>
      )}

      {/* actions */}
      <div className="mt-5 flex flex-col gap-2.5 pb-4">
        <Pill
          disabled={busy || missing.length > 0}
          onClick={() => save(false)}
        >
          {busy ? <Spinner /> : editingId ? "Update post" : "Save & schedule"}
        </Pill>
        <Pill variant="ghost" disabled={busy} onClick={() => save(true)}>
          Preview as Prompted first
        </Pill>
      </div>
    </AppShell>
  );
}
