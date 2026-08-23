"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, ReactNode, useContext } from "react";
import { useApi, SessionStatus } from "@/lib/client";
import { zoneAbbr } from "@/lib/time";
import { Logo } from "./ui";

// App chrome: Prompted-style centered mobile-first layout. Content screens
// stay ~480px at every size; only the data-dense screens (queue, activity)
// pass `wide` to expand to two columns at ≥900px.
//
// The user's IANA timezone flows from the session API through this context to
// every time display — components call useTz() and pass the zone into the
// shared fmt* helpers instead of holding parallel timezone-aware copies.

const TzContext = createContext<{ zone: string; abbr: string; loaded: boolean }>({
  zone: "system",
  abbr: "",
  loaded: false,
});

/** The connected user's timezone (IANA) + abbreviation for labels. */
export function useTz() {
  return useContext(TzContext);
}

const NAV = [
  { href: "/queue", label: "Queue" },
  { href: "/compose", label: "Compose" },
  { href: "/activity", label: "Log" },
];

export default function AppShell({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  const pathname = usePathname();
  const { data: session } = useApi<SessionStatus>("/api/session");

  const needsReconnect = session?.needsReconnect ?? false;
  const tz = session?.connected && session.timezone ? session.timezone : null;
  const tzValue = {
    zone: tz ?? "system",
    abbr: tz ? session?.tzAbbr || zoneAbbr(tz) : "",
    loaded: Boolean(tz),
  };

  return (
    <TzContext.Provider value={tzValue}>
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-[480px] px-4 pt-5 min-[900px]:max-w-[900px]">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-xl tracking-tight text-cream">
              Cadence
            </span>
          </Link>
          <Link
            href={session?.connected ? "/connect" : "/connect"}
            className="chip hover:border-gold/50 hover:text-gold"
            title={
              session?.connected
                ? "Connection settings"
                : "Connect your Prompted account"
            }
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                !session?.connected
                  ? "bg-muted/50"
                  : needsReconnect
                    ? "bg-bad animate-pulse-dot"
                    : "bg-good"
              }`}
            />
            {session?.connected
              ? needsReconnect
                ? "reconnect"
                : `@${session.username}`
              : "connect"}
          </Link>
        </div>

        <nav className="mt-4 flex items-center justify-center gap-2">
          {NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                  active
                    ? "bg-gold/15 text-gold"
                    : "text-muted hover:text-cream"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {needsReconnect && pathname !== "/connect" && (
        <div className="mx-auto mt-4 w-full max-w-[480px] px-4 min-[900px]:max-w-[900px]">
          <div className="card flex items-center justify-between gap-3 border-bad/30 bg-bad/5 px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold text-bad">Session expired.</span>{" "}
              <span className="text-muted">
                Reconnect to keep your queue firing on time.
              </span>
            </div>
            <Link
              href="/connect"
              className="shrink-0 rounded-full border border-bad/40 px-3 py-1 font-mono text-[11px] uppercase text-bad hover:bg-bad/10"
            >
              Reconnect
            </Link>
          </div>
        </div>
      )}

      {session?.tzFallback && (
        <div className="mx-auto mt-4 w-full max-w-[480px] px-4 min-[900px]:max-w-[900px]">
          <div className="card flex items-center justify-between gap-3 border-gold/30 bg-gold/5 px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold text-gold">Timezone fell back to UTC.</span>{" "}
              <span className="text-muted">The saved value wasn&apos;t a valid zone.</span>
            </div>
            <Link
              href="/connect"
              className="shrink-0 rounded-full border border-gold/40 px-3 py-1 font-mono text-[11px] uppercase text-gold hover:bg-gold/10"
            >
              Set zone
            </Link>
          </div>
        </div>
      )}

      <main
        className={`mx-auto w-full flex-1 px-4 pb-24 pt-6 ${
          wide ? "max-w-[480px] min-[900px]:max-w-[900px]" : "max-w-[480px]"
        }`}
      >
        {children}
      </main>

      <footer className="mx-auto w-full max-w-[480px] px-4 pb-8 text-center min-[900px]:max-w-[900px]">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted/60">
          Cadence · free scheduling for prmpted.com
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted/40">
          Vercel + Upstash + cron-job.org · no always-on backend
        </p>
      </footer>
    </div>
    </TzContext.Provider>
  );
}
