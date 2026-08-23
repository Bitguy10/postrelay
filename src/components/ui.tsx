"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useEffect, useState } from "react";
import { countdownText } from "@/lib/time";

// Small shared UI atoms — kept in one file on purpose; they're tiny.

export function Logo({ size = 26 }: { size?: number }) {
  // Three ascending dots on a diagonal: rhythm + a queue building momentum.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Cadence logo">
      <circle cx="5" cy="19" r="2" fill="#8a6524" />
      <circle cx="11.5" cy="12" r="3" fill="#c98f31" />
      <circle cx="18.5" cy="5" r="4.4" fill="#F0A83A" />
    </svg>
  );
}

type PillVariant = "gold" | "ghost" | "danger" | "subtle";

export function Pill({
  children,
  variant = "gold",
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: PillVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";
  const styles: Record<PillVariant, string> = {
    gold: "bg-gold text-ink font-semibold hover:brightness-110 active:scale-[0.98]",
    ghost:
      "border border-line text-cream hover:border-gold/50 hover:text-gold active:scale-[0.98]",
    danger: "border border-bad/40 text-bad hover:bg-bad/10",
    subtle: "border border-line bg-panel2 text-muted hover:text-cream",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function LinkPill({
  href,
  children,
  variant = "gold",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: PillVariant;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-all";
  const styles: Record<PillVariant, string> = {
    gold: "bg-gold text-ink font-semibold hover:brightness-110",
    ghost: "border border-line text-cream hover:border-gold/50 hover:text-gold",
    danger: "border border-bad/40 text-bad hover:bg-bad/10",
    subtle: "border border-line bg-panel2 text-muted hover:text-cream",
  };
  return (
    <Link href={href} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

// Status color language: green = posted, pulsing amber = retrying/firing,
// red = failed/reconnect, dim gold = queued, grey = draft.
export function StatusDot({
  status,
  className = "",
}: {
  status: string;
  className?: string;
}) {
  const map: Record<string, string> = {
    posted: "bg-good",
    retrying: "bg-gold animate-pulse-dot",
    in_progress: "bg-gold animate-pulse-dot",
    failed: "bg-bad",
    queued: "bg-gold/40",
    draft: "bg-muted/40",
  };
  return (
    <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${map[status] ?? "bg-muted/40"} ${className}`} />
  );
}

export function TypeTag({ type }: { type: string }) {
  return <span className="tag text-muted">{type}</span>;
}

export function Countdown({
  target,
  className = "",
}: {
  target: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className={`font-mono text-xs ${className}`}>
      {countdownText(target, now)}
    </span>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card px-5 py-8 text-center text-sm text-muted">{children}</div>
  );
}
