"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { MediaRef } from "@/lib/types";
import { Spinner } from "./ui";

const MAX_BYTES = 3 * 1024 * 1024; // matches the server cap (free-tier friendly)

/**
 * File-or-URL media input. Files upload straight into Prompted's own Supabase
 * storage (via /api/upload) at compose time, so the queue only stores URLs.
 */
export default function MediaInput({
  label,
  value,
  onChange,
  accept,
  kinds,
  multiple = true,
  allowUrl = true,
  required = false,
  hint,
}: {
  label: string;
  value: MediaRef[];
  onChange: (items: MediaRef[]) => void;
  accept: string;
  kinds: "image" | "video" | "any";
  multiple?: boolean;
  allowUrl?: boolean;
  required?: boolean;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");

  const kindOf = (mime: string, name: string): MediaRef["kind"] => {
    if (mime.startsWith("video/") || /\.(mp4|webm|mov)(\?|$)/i.test(name)) return "video";
    if (mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(name)) return "image";
    return "file";
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError(
        `${file.name} is ${(file.size / 1048576).toFixed(1)}MB — cap is 3MB. Paste a hosted URL instead.`,
      );
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      const res = await api<{ media: MediaRef }>("/api/upload", {
        method: "POST",
        body: JSON.stringify({ name: file.name, mime: file.type, dataUrl }),
      });
      onChange(multiple ? [...value, res.media] : [res.media]);
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Upload failed") +
          " — you can paste a hosted URL instead.",
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addUrl = () => {
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) {
      setError("Enter a full https:// URL");
      return;
    }
    setError(null);
    const kind = kindOf("", u);
    const item: MediaRef = {
      kind: kinds === "video" && kind === "file" ? "video" : kind,
      name: u.split("/").pop() || u,
      mime: "",
      url: u,
    };
    onChange(multiple ? [...value, item] : [item]);
    setUrl("");
  };

  return (
    <div>
      <span className="label">
        {label}
        {required && <span className="text-gold"> · required</span>}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded-full border border-dashed border-line px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:border-gold/60 hover:text-gold disabled:opacity-50"
        >
          {busy ? <Spinner /> : `Upload ${kinds === "video" ? "video" : "file"}`}
        </button>
        {hint && <span className="font-mono text-[10px] text-muted/70">{hint}</span>}
      </div>

      {allowUrl && (
        <div className="mt-2 flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or paste a hosted URL"
            className="field flex-1"
          />
          <button
            type="button"
            onClick={addUrl}
            className="rounded-full border border-line px-4 text-sm text-muted hover:border-gold/50 hover:text-gold"
          >
            Add
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}

      {value.length > 0 && (
        <ul className="mt-3 space-y-2">
          {value.map((m, i) => (
            <li
              key={`${m.url}-${i}`}
              className="flex items-center gap-3 rounded-xl border border-line bg-panel2 px-3 py-2"
            >
              {m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.name} className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink font-mono text-[9px] uppercase text-muted">
                  {m.kind}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{m.name || m.url}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="text-muted hover:text-bad"
                aria-label={`Remove ${m.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
