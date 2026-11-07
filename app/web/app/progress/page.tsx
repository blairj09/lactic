import Nav from "@/components/nav";
import RideCalendar from "@/components/ride-calendar";
import { Page, PageHeader, Panel } from "@/components/ui";
import { loadAthlete, loadRides, type Athlete } from "@/lib/activities";
import { loadBodyMeasurements } from "@/lib/body-data";
import { mergeCurves } from "@/lib/engine/power";
import { fitnessSummary } from "@/lib/health-summary";
import { loadAnalysis } from "@/lib/analysis-data";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import LevelsPanel from "@/components/levels-panel";
import { localDate } from "@/lib/engine/activity";
import { loadCalendarRides } from "@/lib/ride-calendar-data";
import { loadTrainingState } from "@/lib/training";
import FitnessPanel, { FITNESS_DAYS } from "./fitness-panel";
import ProgressView from "./progress-view";

export const metadata = { title: "Progress · My Coach" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Where training history lives: the range charts on top, every ride below. Rides and Analysis used to be two pages. */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const [data, athlete, rides, params, state] = await Promise.all([
    loadAnalysis(supabase),
    loadAthlete(supabase),
    loadRides(supabase, undefined, { includeCopies: true }),
    searchParams,
    loadTrainingState(supabase).catch((e) => (console.error(e), null)),
  ]);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const counted = rides.filter((r) => !r.duplicateOf).length;
  const [calendar, fitness] = await Promise.all([
    loadCalendarRides(supabase, rides, athlete.timezone),
    loadFitness(supabase, athlete, rides).catch((e) => (console.error(e), null)),
  ]);
  return (
    <>
      <Nav current="/progress" />
      <Page>
        <div className="space-y-8">
          <ProgressView
            data={data}
            initial={{ from: one(params.from), to: one(params.to), compare: one(params.compare) }}
            fitness={fitness && <FitnessPanel fitness={fitness} />}
            levels={state && <LevelsPanel state={state} />}
          />
          <Panel title="Rides" meta={`${counted} counted, copies once`} className="min-w-0">
            {rides.length > 0 ? (
              <RideCalendar rides={calendar} timeZone={athlete.timezone} today={localDate(new Date(), athlete.timezone)} />
            ) : (
              <p className="text-sm text-muted">
                No rides yet. Connect intervals.icu or import FIT files in{" "}
                <Link href="/settings#connections" className="text-ink underline underline-offset-4">
                  Settings
                </Link>{" "}
                to bring your history in.
              </p>
            )}
          </Panel>
        </div>
      </Page>
    </>
  );
}

/** VO2 max and fitness age now: best 5 minutes of the last 90 days at your latest weight, or Apple Watch's Cardio Fitness. */
async function loadFitness(supabase: Awaited<ReturnType<typeof createClient>>, athlete: Athlete, rides: Awaited<ReturnType<typeof loadRides>>) {
  const today = localDate(new Date(), athlete.timezone);
  const since = Date.now() - FITNESS_DAYS * 86_400_000;
  const curves = rides.flatMap((r) => (!r.duplicateOf && r.powerCurve && r.startedAt.getTime() >= since ? [r.powerCurve] : []));
  const [measurements, apple] = await Promise.all([
    loadBodyMeasurements(supabase, new Date(Date.now() - 90 * 86_400_000)),
    supabase.from("health_days").select("day, vo2max").not("vo2max", "is", null).lte("day", today).order("day", { ascending: false }).limit(1),
  ]);
  if (apple.error) console.error(apple.error);
  const latestApple = apple.data?.[0];
  return fitnessSummary({
    athlete,
    today,
    bestFiveMinuteWatts: curves.length ? (mergeCurves(...curves)[300] ?? null) : null,
    weightKg: measurements.at(-1)?.weightKg ?? athlete.weightKg,
    appleVo2max: latestApple ? { day: latestApple.day, value: Number(latestApple.vo2max) } : null,
  });
}
