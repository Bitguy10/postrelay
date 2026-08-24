"use client";

import { useCallback, useEffect, useState } from "react";
import { Batch, Post, ActivityEntry, Refs } from "./types";

// Each browser gets a random device id (localStorage); the server maps it to
// exactly one connected Prompted account, so every account's data is isolated.
function deviceId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem("postrelay-device");
    if (!id) {
      id =
        (globalThis.crypto?.randomUUID?.() ??
          Math.random().toString(36).slice(2) + Date.now().toString(36));
      window.localStorage.setItem("postrelay-device", id);
    }
    return id;
  } catch {
    return "";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-postrelay-device": deviceId(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export function useApi<T>(path: string | null, opts?: { refreshMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      setError(null);
      const d = await api<T>(path);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!opts?.refreshMs || !path) return;
    const t = setInterval(refresh, opts.refreshMs);
    return () => clearInterval(t);
  }, [refresh, opts?.refreshMs, path]);

  return { data, error, loading, refresh, setData };
}

// ---- API response shapes ----

export interface SessionStatus {
  connected: boolean;
  username: string | null;
  email: string | null;
  needsReconnect: boolean;
  refreshedAt: string | null;
  connectedAt: string | null;
  /** IANA zone times are entered/displayed in, e.g. "Africa/Lagos". */
  timezone: string | null;
  tzAbbr: string | null;
  /** True when a stored/provided zone was invalid and we fell back to UTC. */
  tzFallback: boolean;
  /** ISO of the last authenticated cron tick, if any. */
  lastTickAt: string | null;
  /** True when a heartbeat exists but is >10 min old — cron isn't reaching us. */
  heartbeatStale: boolean;
  /** "password" = independent self-healing session; "token" = pasted. */
  authMode: "password" | "token" | null;
  config: { redis: boolean; encryptionKey: boolean; cronSecret: boolean };
}

export interface PostsResponse {
  posts: Post[];
  batches: Batch[];
}

export interface BatchWithStats extends Batch {
  counts: { total: number; posted: number; queued: number; failed: number };
  nextSlot: string;
  posts: { id: string; title: string; type: string; fireAt: string; status: string }[];
}

export interface BatchesResponse {
  batches: BatchWithStats[];
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  stats: { posted: number; failed: number; retrying: number; successRate: number };
  needsReconnect: boolean;
}

export interface RefsResponse {
  refs: Refs;
  source: "cache" | "live-sync";
}
