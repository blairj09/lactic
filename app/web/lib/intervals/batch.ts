// Picking which intervals.icu activities to fetch next. Pure, so it tests without the network.

import { isRide } from "../strava/convert";

/** The fields we use from an intervals.icu activity summary. */
export interface IntervalsActivity {
  id: string;
  name?: string | null;
  type?: string | null;
  /** Local start time without a zone, e.g. "2026-10-29T07:35:18". */
  start_date_local: string;
  /** UTC start time, e.g. "2026-10-29T14:35:18Z". */
  start_date?: string | null;
  /** Where intervals.icu got it. Strava-sourced activities can't be read over the API. */
  source?: string | null;
  /** Seconds from start to finish, pauses included. */
  elapsed_time?: number | null;
}

export const canImport = (a: IntervalsActivity) => isRide({ sport_type: a.type ?? "" }) && a.source !== "STRAVA";

/** Rides intervals.icu got from Strava: listed, but their data isn't readable over its API. */
export const stravaRides = (activities: IntervalsActivity[]) => activities.filter((a) => a.source === "STRAVA" && isRide({ sport_type: a.type ?? "" })).length;

/**
 * The next batch walking forward from `after` (exclusive) or back from `before` (exclusive), with the
 * cursor to resume from. Local start times are fixed-format strings, so they compare as text.
 */
export function nextBatch(
  activities: IntervalsActivity[],
  direction: { after: string } | { before: string },
  size: number,
): { batch: IntervalsActivity[]; cursor: string | null; more: boolean } {
  const forward = "after" in direction;
  const inRange = activities
    .filter((a) => (forward ? a.start_date_local > direction.after : a.start_date_local < direction.before))
    .sort((a, b) => (forward ? 1 : -1) * a.start_date_local.localeCompare(b.start_date_local));
  const taken = inRange.slice(0, size);
  return { batch: taken.filter(canImport), cursor: taken.at(-1)?.start_date_local ?? null, more: inRange.length > size };
}

/** Rides start within this of their intervals.icu activity: both come from the same file. */
const LINK_TOLERANCE_MS = 120_000;

/**
 * Pairs stored rides with the intervals.icu activities they match by start time, nearest first, each
 * activity used once. Returns ride id -> intervals.icu activity id.
 */
export function matchActivities(rides: { id: string; startedAt: Date }[], activities: IntervalsActivity[]): Map<string, string> {
  const starts = activities.flatMap((a) => {
    const t = a.start_date ? Date.parse(a.start_date) : NaN;
    return Number.isNaN(t) || !isRide({ sport_type: a.type ?? "" }) ? [] : [{ id: a.id, t }];
  });
  const pairs = rides
    .flatMap((r) => starts.map((a) => ({ ride: r.id, activity: a.id, gap: Math.abs(a.t - r.startedAt.getTime()) })))
    .filter((p) => p.gap <= LINK_TOLERANCE_MS)
    .sort((x, y) => x.gap - y.gap);
  const linked = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (linked.has(p.ride) || used.has(p.activity)) continue;
    linked.set(p.ride, p.activity);
    used.add(p.activity);
  }
  return linked;
}

/** Shared minutes that make an activity the same ride as one recorded here, or half the ride when it's shorter. */
const SAME_RIDE_OVERLAP_S = 300;
/** Without a listed length, an activity starting this close is taken to be the same ride. */
const SAME_RIDE_START_MS = 600_000;

/**
 * The listed ride that covers the same time as a ride recorded here (Zwift or the Karoo sent it), if
 * any. Strava-sourced activities count too: they're the same ride even though their data isn't readable.
 */
export function sameRide(ride: { startedAt: Date; durationSeconds: number }, activities: IntervalsActivity[]): IntervalsActivity | null {
  const start = ride.startedAt.getTime();
  const end = start + ride.durationSeconds * 1000;
  const needed = Math.min(SAME_RIDE_OVERLAP_S, ride.durationSeconds / 2) * 1000;
  return (
    activities.find((a) => {
      const t = a.start_date ? Date.parse(a.start_date) : NaN;
      if (Number.isNaN(t) || !isRide({ sport_type: a.type ?? "" })) return false;
      if (!a.elapsed_time) return Math.abs(t - start) <= SAME_RIDE_START_MS;
      return Math.min(end, t + a.elapsed_time * 1000) - Math.max(start, t) >= needed;
    }) ?? null
  );
}
