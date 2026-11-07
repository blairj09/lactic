// What the Analysis page reads: every ride as a dated slice for range summaries, and the fitness series.

import { loadAthlete, loadRides } from "./activities";
import { dailyStress, ftpOn, localDate } from "./engine/activity";
import { keepersWithCopyData, type RangeRide } from "./engine/analysis";
import { addDays, fitnessSeries } from "./engine/pmc";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AnalysisData {
  today: string;
  /** First day with a ride, or today. */
  earliest: string;
  rides: RangeRide[];
  days: { date: string; fitness: number; fatigue: number; form: number }[];
  ftp: number | null;
  /** For W/kg in the power profile. */
  weightKg: number | null;
  sex: "male" | "female" | null;
  /** Rides with power but no histogram: imported before histograms were kept. */
  missingHistograms: number;
}

export async function loadAnalysis(supabase: Supabase): Promise<AnalysisData> {
  const athlete = await loadAthlete(supabase);
  const tz = athlete.timezone;
  const today = localDate(new Date(), tz);
  const rides = keepersWithCopyData(await loadRides(supabase, undefined, { includeCopies: true }));
  const earliest = rides.length ? localDate(rides[rides.length - 1].startedAt, tz) : today;
  const series = fitnessSeries(dailyStress(rides, tz), earliest < today ? earliest : addDays(today, -1), today);
  return {
    today,
    earliest: earliest < today ? earliest : today,
    rides: rides.map((r) => {
      const date = localDate(r.startedAt, tz);
      return {
        date,
        durationSeconds: r.durationSeconds,
        ftp: ftpOn(date, athlete.ftpHistory, athlete.ftp),
        powerCurve: r.powerCurve,
        powerHistogram: r.powerHistogram,
      };
    }),
    days: series.map(({ date, fitness, fatigue, form }) => ({ date, fitness, fatigue, form })),
    ftp: athlete.ftp,
    weightKg: athlete.weightKg,
    sex: athlete.sex,
    missingHistograms: rides.filter((r) => r.powerCurve && !r.powerHistogram).length,
  };
}
