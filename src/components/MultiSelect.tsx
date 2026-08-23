"use client";

import { useEffect, useRef, useState } from "react";

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Searchable multi-select (or single-select when multi=false) reading from the
 * live-synced reference cache — never a hardcoded list.
 */
export default function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  multi = true,
  disabled = false,
}: {
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder: string;
  multi?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );

  const selected = options.filter((o) => value.includes(o.id));
  const label = selected.length
    ? selected.map((o) => o.label).join(", ")
    : placeholder;

  const toggle = (id: string) => {
    if (!multi) {
      onChange(value[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between gap-2 text-left ${
          selected.length ? "text-cream" : "text-muted/70"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        <span className="truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {multi && selected.length > 0 && (
            <span className="rounded-md bg-gold/15 px-1.5 py-0.5 font-mono text-[10px] text-gold">
              {selected.length}
            </span>
          )}
          <svg width="10" height="6" viewBox="0 0 10 6" className={`transition-transform ${open ? "rotate-180" : ""}`}>
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-line bg-panel2 shadow-xl shadow-black/60">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg bg-ink px-3 py-2 text-sm text-cream placeholder:text-muted/50 focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted">
                {options.length === 0
                  ? "Nothing synced yet — sync runs daily once connected."
                  : "No matches"}
              </p>
            )}
            {filtered.map((o) => {
              const on = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-gold/10 ${
                    on ? "text-gold" : "text-cream"
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="truncate">{o.label}</span>
                    {o.hint && (
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {o.hint}
                      </span>
                    )}
                  </span>
                  {on && (
                    <svg width="13" height="13" viewBox="0 0 14 14" className="shrink-0">
                      <path d="M2 7.5l3.2 3L12 3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
