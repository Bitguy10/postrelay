"use client";

import { fmtStamp } from "@/lib/time";
import { useTz } from "./AppShell";

export interface RailItem {
  id: string;
  title: string;
  fireAt: string;
  type: string;
}

/**
 * PostRelay's signature visual: a vertical dotted timeline. The next post to
 * fire is a pulsing gold dot; everything queued after fades progressively.
 * Times render in the connected user's timezone.
 */
export default function QueueRail({ items }: { items: RailItem[] }) {
  const { zone } = useTz();
  const fade = (i: number) => Math.max(0.3, 1 - i * 0.22);

  return (
    <div className="relative pl-7">
      <div className="rail-line absolute bottom-1.5 left-[7px] top-1.5" />
      <ul className="space-y-5">
        {items.map((item, i) => (
          <li key={item.id} className="relative" style={{ opacity: fade(i) }}>
            <span
              className={`absolute -left-7 top-1 block rounded-full ${
                i === 0
                  ? "h-3.5 w-3.5 bg-gold animate-pulse-gold"
                  : i === items.length - 1
                    ? "h-2 w-2 bg-gold/50"
                    : "h-2.5 w-2.5 bg-gold/60"
              }`}
              style={{ left: i === 0 ? -29 : -26 }}
            />
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-gold/80">
                {fmtStamp(item.fireAt, zone)}
              </span>
              <span className="tag border-line text-muted/80">{item.type}</span>
            </div>
            <p className="mt-0.5 truncate text-sm text-cream/90">
              {item.title || "(untitled)"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
