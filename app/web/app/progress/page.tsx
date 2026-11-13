import Nav from "@/components/nav";
import RideCalendar from "@/components/ride-calendar";
import { Page, PageHeader, Panel } from "@/components/ui";
import ProgressTabs from "./progress-tabs";
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
import WeekReviewCard from "../week-review";
import { loadReview } from "@/lib/coach/store";
import { addDays } from "@/lib/engine/pmc";
import { PHASE_LABELS, weekStart } from "@/lib/engine/plan";
import type { WeekReview } from "@/lib/engine/review";

export const metadata = { title: "Progress · My Coach" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Where training history lives, in two tabs: Trends (the range charts) and Rides (every ride, as a calendar or a list). */
export default async function ProgressPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createClient();
  const params = await searchParams;
  if (params.tab === "rides") return <RidesTab supabase={supabase} />;
  const [data, athlete, rides, state] = await Promise.all([
    loadAnalysis(supabase),
    loadAthlete(supabase),
    loadRides(supabase, undefined, { includeCopies: true }),
    loadTrainingState(supabase).catch((e) => (console.error(e), null)),
  ]);
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  // One weight for the page: the latest weigh-in of the last 90 days, else the profile weight. W/kg in the power
  // profile and VO2 max both use it.
  const measurements = await loadBodyMeasurements(supabase, new Date(Date.now() - 90 * 86_400_000)).catch((e) => (console.error(e), []));
  const weightKg = measurements.at(-1)?.weightKg ?? athlete.weightKg;
  const monday = weekStart(localDate(new Date(), athlete.timezone));
  const reviewMessage = await loadReview(supabase, addDays(monday, -7)).catch((e) => (console.error(e), null));
  const thisWeek = state?.plan.weeks.find((w) => w.start === monday);
  const review = reviewMessage?.meta.review ? (
    <WeekReviewCard
      review={reviewMessage.meta.review as WeekReview}
      message={reviewMessage.content}
      thisWeek={thisWeek ? `This week: ${PHASE_LABELS[thisWeek.phase].toLowerCase()}${thisWeek.recoveryWeek ? " (recovery week)" : ""}, ${thisWeek.stress} TSS planned.` : null}
    />
  ) : null;
  const fitness = await loadFitness(supabase, athlete, rides, weightKg).catch((e) => (console.error(e), null));
  return (
    <>
      <Nav current="/progress" />
      <Page>
        <ProgressView
          data={{ ...data, weightKg }}
          initial={{ from: one(params.from), to: one(params.to), compare: one(params.compare) }}
          tabs={<ProgressTabs tab="trends" />}
          fitness={fitness && <FitnessPanel fitness={fitness} today={localDate(new Date(), athlete.timezone)} />}
          levels={state && <LevelsPanel state={state} />}
          review={review}
        />
      </Page>
    </>
  );
}

/** Every ride as a month calendar or a list, with search and filters. */
async function RidesTab({ supabase }: { supabase: Awaited<ReturnType<typeof createClient>> }) {
  const [athlete, rides] = await Promise.all([loadAthlete(supabase), loadRides(supabase, undefined, { includeCopies: true })]);
  const counted = rides.filter((r) => !r.duplicateOf).length;
  const calendar = await loadCalendarRides(supabase, rides, athlete.timezone);
  return (
    <>
      <Nav current="/progress" />
      <Page>
        <div className="space-y-8">
          <PageHeader title="Progress" line={`${counted} ride${counted === 1 ? "" : "s"}. Open one for its charts and map.`} />
          <ProgressTabs tab="rides" />
          {rides.length > 0 ? (
            <Panel className="min-w-0">
              <RideCalendar rides={calendar} timeZone={athlete.timezone} today={localDate(new Date(), athlete.timezone)} />
            </Panel>
          ) : (
            <p className="text-sm text-muted">
              No rides yet. Connect intervals.icu or import FIT files in{" "}
              <Link href="/settings#connections" className="text-ink underline underline-offset-4">
                Settings
              </Link>{" "}
              to bring your history in.
            </p>
          )}
        </div>
      </Page>
    </>
  );
}

/** VO2 max and fitness age now: best 5 minutes of the last 90 days at your latest weight, or Apple Watch's Cardio Fitness. */
async function loadFitness(supabase: Awaited<ReturnType<typeof createClient>>, athlete: Athlete, rides: Awaited<ReturnType<typeof loadRides>>, weightKg: number | null) {
  const today = localDate(new Date(), athlete.timezone);
  const since = Date.now() - FITNESS_DAYS * 86_400_000;
  const curves = rides.flatMap((r) => (!r.duplicateOf && r.powerCurve && r.startedAt.getTime() >= since ? [r.powerCurve] : []));
  const apple = await supabase.from("health_days").select("day, vo2max").not("vo2max", "is", null).lte("day", today).order("day", { ascending: false }).limit(1);
  if (apple.error) console.error(apple.error);
  const latestApple = apple.data?.[0];
  return fitnessSummary({
    athlete,
    today,
    bestFiveMinuteWatts: curves.length ? (mergeCurves(...curves)[300] ?? null) : null,
    weightKg,
    appleVo2max: latestApple ? { day: latestApple.day, value: Number(latestApple.vo2max) } : null,
  });
}
