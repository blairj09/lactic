import type { BodyPoint } from "./engine/body";
import { localDate } from "./engine/activity";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface BodyMeasurement extends BodyPoint {
  id: string;
  bmi: number | null;
  fatFreeMassKg: number | null;
}

/** Weigh-ins since a date, oldest first. */
export async function loadBodyMeasurements(supabase: Supabase, since: Date): Promise<BodyMeasurement[]> {
  const { data, error } = await supabase
    .from("body_measurements")
    .select("id, measured_at, weight_kg, bmi, body_fat_pct, fat_free_mass_kg")
    .gte("measured_at", since.toISOString())
    .order("measured_at");
  if (error) throw error;
  const num = (v: string | number | null) => (v === null ? null : Number(v));
  return data.map((r) => ({
    id: r.id,
    measuredAt: new Date(r.measured_at),
    weightKg: Number(r.weight_kg),
    bmi: num(r.bmi),
    bodyFatPercent: num(r.body_fat_pct),
    fatFreeMassKg: num(r.fat_free_mass_kg),
  }));
}

/** The latest weigh-in on a local day, if there was one. `measurements` oldest first. */
export function weighInOn<T extends BodyPoint>(measurements: T[], day: string, timeZone: string): T | undefined {
  return measurements.findLast((m) => localDate(m.measuredAt, timeZone) === day);
}
