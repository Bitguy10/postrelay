import { DateTime } from "luxon";
import { Batch, Post } from "./types";
import { nextOccurrence, occurrenceAfter, resolveZone } from "./time";

// Drip-queue slot math. A batch owns a cadence: intervalDays + a wall-clock
// time of day in an IANA zone. Every slot is computed per-occurrence against
// that zone, so "9:00am" stays 9:00am across DST transitions.

export const batchZone = (batch: Batch): string => resolveZone(batch.timezone);

export function computeNextSlot(batch: Batch, posts: Post[]): Date {
  const zone = batchZone(batch);
  const placed = posts.filter(
    (p) => p.batchId === batch.id && p.status !== "draft",
  );
  if (placed.length === 0) {
    return nextOccurrence(batch.timeOfDay, zone).toJSDate();
  }
  const latest = placed.reduce(
    (max, p) =>
      DateTime.fromISO(p.fireAt) > max ? DateTime.fromISO(p.fireAt) : max,
    DateTime.fromISO(placed[0].fireAt),
  );
  return occurrenceAfter(
    latest.toISO()!,
    Math.max(1, batch.intervalDays),
    batch.timeOfDay,
    zone,
  ).toJSDate();
}

/**
 * Re-compute future slots after a cadence edit: keep the batch's queued
 * (not-yet-fired) posts in their existing order, re-space them from the next
 * occurrence of the new time-of-day in the (possibly new) zone. Posts already
 * fired or in-flight are untouched.
 */
export function recomputeSlots(
  batch: Batch,
  posts: Post[],
): { updated: Post[]; nextSlot: string } {
  const zone = batchZone(batch);
  const pending = posts
    .filter(
      (p) =>
        p.batchId === batch.id &&
        (p.status === "queued" || p.status === "draft"),
    )
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));

  let slot = nextOccurrence(batch.timeOfDay, zone);
  const updated: Post[] = pending.map((p) => {
    const next = { ...p, fireAt: slot.toUTC().toISO()! };
    slot = occurrenceAfter(
      slot.toISO()!,
      Math.max(1, batch.intervalDays),
      batch.timeOfDay,
      zone,
    );
    return next;
  });
  return {
    updated,
    nextSlot: nextOccurrence(batch.timeOfDay, zone).toISO()!,
  };
}
