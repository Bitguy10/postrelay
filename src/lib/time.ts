import { DateTime, IANAZone } from "luxon";

// Time layer: everything stored is a UTC instant; everything entered or shown
// is wall-clock time in a specific IANA zone (never a fixed offset — offsets
// drift across DST). Conversions go through Luxon, not manual offset math.
//
// Relative countdowns are zone-independent (instants), so countdownText stays
// plain Date math.

export const MIN = 60_000;

/** "system" is what we use before a user zone loads; resolve it to IANA. */
export function resolveZone(zone: string | null | undefined): string {
  if (zone && IANAZone.isValidZone(zone)) return zone;
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && IANAZone.isValidZone(detected)) return detected;
  } catch {
    // Intl unavailable
  }
  return "UTC";
}

export const isValidZone = (zone: string | null | undefined): zone is string =>
  typeof zone === "string" && IANAZone.isValidZone(zone);

/** Zone abbreviation for labels, e.g. "EDT", "GMT+1". Falls back to "". */
const abbrCache = new Map<string, string>();
export function zoneAbbr(zone: string): string {
  const z = resolveZone(zone);
  const cached = abbrCache.get(z);
  if (cached !== undefined) return cached;
  try {
    const abbr =
      new Intl.DateTimeFormat("en-US", {
        timeZone: z,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    abbrCache.set(z, abbr);
    return abbr;
  } catch {
    return "";
  }
}

function parseHm(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(":").map((n) => parseInt(n, 10));
  return { hour, minute };
}

/**
 * Next occurrence of a wall-clock time ("09:00") in an IANA zone, strictly
 * after `from`. Constructed from wall components, so it is DST-correct.
 */
export function nextOccurrence(
  hhmm: string,
  zone: string,
  from: DateTime = DateTime.now(),
): DateTime {
  const { hour, minute } = parseHm(hhmm);
  let dt = from.setZone(resolveZone(zone)).startOf("day").set({ hour, minute });
  if (dt <= from) dt = dt.plus({ days: 1 });
  return dt;
}

/**
 * The occurrence after a previous one, stepping `intervalDays` on the zone's
 * calendar and re-anchoring at the wall-clock time — each occurrence is
 * recomputed against the zone, so 9:00am stays 9:00am across DST changes
 * instead of drifting by an hour. Skips past `from` (now) when catching up.
 */
export function occurrenceAfter(
  prevIso: string,
  intervalDays: number,
  hhmm: string,
  zone: string,
): DateTime {
  const step = Math.max(1, intervalDays);
  const { hour, minute } = parseHm(hhmm);
  const z = resolveZone(zone);
  let dt = DateTime.fromISO(prevIso)
    .setZone(z)
    .startOf("day")
    .plus({ days: step })
    .set({ hour, minute });
  const now = DateTime.now();
  while (dt <= now) dt = dt.plus({ days: step });
  return dt;
}

/** datetime-local input value ("2026-08-25T09:00") in `zone` → UTC ISO. */
export function localInputToUtcIso(
  value: string,
  zone: string,
): string | null {
  const dt = DateTime.fromISO(value, { zone: resolveZone(zone) });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

/** Stored UTC ISO → datetime-local input value in `zone`. */
export function utcToLocalInput(iso: string, zone: string): string {
  return DateTime.fromISO(iso)
    .setZone(resolveZone(zone))
    .toFormat("yyyy-LL-dd'T'HH:mm");
}

const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** e.g. "AUG 25 · 09:00" in the given zone. */
export function fmtStamp(iso: string, zone = "system"): string {
  const dt = DateTime.fromISO(iso).setZone(resolveZone(zone));
  return `${MONTHS[dt.month - 1]} ${dt.day} · ${dt.toFormat("HH:mm")}`;
}

/** e.g. "Aug 25, 2026" in the given zone. */
export function fmtDate(iso: string, zone = "system"): string {
  return DateTime.fromISO(iso)
    .setZone(resolveZone(zone))
    .toLocaleString(DateTime.DATE_MED);
}

/** e.g. "14:32" in the given zone. */
export function fmtTime(iso: string, zone = "system"): string {
  return DateTime.fromISO(iso).setZone(resolveZone(zone)).toFormat("HH:mm");
}

/** "Today" / "Yesterday" / "Aug 25, 2026" — calendar days in the given zone. */
export function dayLabel(iso: string, zone = "system"): string {
  const z = resolveZone(zone);
  const dt = DateTime.fromISO(iso).setZone(z).startOf("day");
  const now = DateTime.now().setZone(z).startOf("day");
  const dayDiff = Math.round(dt.diff(now, "days").days);
  if (dayDiff === 0) return "Today";
  if (dayDiff === -1) return "Yesterday";
  return fmtDate(iso, z);
}

/** e.g. "in 2d 4h" / "in 12m" / "firing…" — relative, zone-independent. */
export function countdownText(targetIso: string, nowMs = Date.now()): string {
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return "firing…";
  const mins = Math.floor(diff / MIN);
  if (mins < 1) return "in <1m";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `in ${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}
