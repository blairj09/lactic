// The rider's own drag, measured from their recent outdoor rides' files on intervals.icu, and how
// well the riding model timed those rides. Kept in app_settings; the pre-race report uses it for
// road events. The numbers come from the engine (engine/course/calibrate.ts).

import { decodeFit } from "./fit/decode";
import { combineFits, fitDrag, timeError, type DragFit, type RideRecord } from "./engine/course/calibrate";
import { bikeSetup } from "./engine/course/pacing";
import { downloadOriginal, loadConnection } from "./intervals/client";
import { getSetting, setSetting } from "~/settings/store";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface RiderDrag {
  cda: number;
  crr: number;
  /** Rides it was measured from. */
  rides: number;
  /** Median error timing those rides from their own power, as a fraction; null when too few to check. */
  error: number | null;
  /** When it was measured. */
  at: string;
}

const KEY = "rider_drag";
const BIKE_KG = 8.5;
const MAX_RIDES = 8;

export async function loadRiderDrag(): Promise<RiderDrag | null> {
  const v = await getSetting<RiderDrag | null>(KEY, null).catch(() => null);
  return v && typeof v.cda === "number" && v.cda > 0 ? v : null;
}

/**
 * Measures the rider's drag from their latest outdoor rides (files from intervals.icu), checks the
 * model against each ride with the drag from the others, and saves it.
 */
export async function measureRiderDrag(supabase: Supabase, weightKg: number | null): Promise<RiderDrag> {
  const connection = await loadConnection(supabase);
  if (!connection) throw new Error("This reads your outdoor rides' files from intervals.icu: connect it in Settings first.");
  if (!weightKg) throw new Error("Set your weight in Settings first: drag can't be worked out without it.");
  const mass = weightKg + BIKE_KG;
  const { data, error } = await supabase
    .from("activities")
    .select("id, intervals_id, source, started_at")
    .not("intervals_id", "is", null)
    .in("source", ["karoo_fit", "fit"])
    .gte("duration_seconds", 30 * 60)
    .order("started_at", { ascending: false })
    .limit(MAX_RIDES * 3);
  if (error) throw error;
  const rides: RideRecord[][] = [];
  for (const row of data ?? []) {
    if (rides.length >= MAX_RIDES) break;
    const bytes = await downloadOriginal(connection.apiKey, String(row.intervals_id)).catch(() => null);
    if (!bytes) continue;
    try {
      const fit = decodeFit(bytes);
      // Outdoors only: a trainer's file has a made-up speed and no real hills.
      const located = fit.records.filter((r) => r.lat !== undefined).length;
      if (located < fit.records.length * 0.8) continue;
      const origin = fit.records[0]?.timestamp.getTime() ?? 0;
      rides.push(fit.records.map((r) => ({ t: (r.timestamp.getTime() - origin) / 1000, distance: r.distance ?? null, altitude: r.altitude ?? null, power: r.power ?? null })));
    } catch {
      // A file that won't read is skipped.
    }
  }
  const fits = rides.map((r) => fitDrag(r, mass));
  const usable = fits.filter((f): f is DragFit => f !== null);
  const combined = combineFits(usable);
  if (!combined) throw new Error(`Not enough outdoor riding with power to measure: ${usable.length} of your recent rides could be used, and it takes at least 2 (each with 15 minutes or more of steady pedaling on roads that aren't too steep).`);
  // Each ride checked with the drag measured from the others, so it isn't marking its own homework.
  const maxKmh = bikeSetup("granFondo").maxKmh;
  const errors: number[] = [];
  rides.forEach((r, i) => {
    if (!fits[i]) return;
    const others = combineFits(usable.filter((f) => f !== fits[i])) ?? combined;
    const e = timeError(r, mass, { cda: others.cda, crr: others.crr, maxKmh });
    if (e !== null) errors.push(Math.abs(e));
  });
  errors.sort((a, b) => a - b);
  const result: RiderDrag = {
    cda: combined.cda,
    crr: combined.crr,
    rides: combined.rides,
    error: errors.length >= 2 ? Math.round(errors[errors.length >> 1] * 1000) / 1000 : null,
    at: new Date().toISOString(),
  };
  await setSetting(KEY, result);
  return result;
}
