"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import MultiSelect, { Option } from "./MultiSelect";
import { resolveZone, zoneAbbr } from "@/lib/time";

// Searchable IANA timezone picker. Options come from the browser's own
// Intl.supportedValuesOf("timeZone") (~400 zones, no bundled list needed),
// labeled with the zone's current UTC offset. Falls back to a plain input on
// browsers without the API.

function zoneOptions(): Option[] {
  const zones: string[] =
    (
      Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf?.("timeZone") ?? [];
  const now = DateTime.now();
  return zones.map((z) => ({
    id: z,
    label: z.replace(/_/g, " "),
    hint: `${zoneAbbr(z)} ${now.setZone(z).toFormat("ZZ")}`,
  }));
}

export default function TimezonePicker({
  value,
  onApply,
  busy = false,
  detected,
}: {
  value: string;
  onApply: (zone: string) => void;
  busy?: boolean;
  detected?: string;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string[]>([value]);
  const [manual, setManual] = useState(value);
  const options = useMemo(() => zoneOptions(), []);

  if (!open) {
    const z = resolveZone(value);
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-line px-3.5 py-1.5 font-mono text-[11px] text-muted hover:border-gold/50 hover:text-gold"
      >
        {z.replace(/_/g, " ")} ({zoneAbbr(z)}) — change
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-panel2 p-3">
      {options.length > 0 ? (
        <>
          <MultiSelect
            options={options}
            value={choice}
            onChange={setChoice}
            placeholder="Search country / city…"
            multi={false}
          />
          {detected && (
            <button
              type="button"
              onClick={() => setChoice([resolveZone(detected)])}
              className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted hover:text-gold"
            >
              use detected · {resolveZone(detected).replace(/_/g, " ")}
            </button>
          )}
        </>
      ) : (
        <input
          className="field"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="IANA zone, e.g. Africa/Lagos"
        />
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || (options.length > 0 && choice.length === 0)}
          onClick={() => onApply(resolveZone(options.length > 0 ? choice[0] : manual))}
          className="rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] font-semibold uppercase text-ink disabled:opacity-40"
        >
          {busy ? "…" : "Apply zone"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-line px-4 py-1.5 font-mono text-[10px] uppercase text-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
