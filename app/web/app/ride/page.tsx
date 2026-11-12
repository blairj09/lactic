import { STARTING_LEVELS } from "@/lib/engine/library";
import { loadCustomWorkouts } from "@/lib/custom-workouts";
import { ftpIsGuess } from "@/lib/engine/ftp-check";
import { authEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { loadPlanDays, loadTrainingState, sessionFor } from "@/lib/training";
import { firstRideSession } from "@/lib/first-ride";
import { loadLayout } from "@/lib/layout-data";
import RideScreen from "./ride-screen";

export const metadata = { title: "Ride · My Coach" };
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d\d-\d\d$/;

export default async function RidePage({ searchParams }: { searchParams: Promise<{ day?: string; source?: string; first?: string }> }) {
  if (!authEnabled) return <RideScreen initialFtp={null} canSave={false} levels={STARTING_LEVELS} />;
  const supabase = await createClient();
  const { day: asked, source, first } = await searchParams;
  // Ride now offers a plan day's session first: the one asked for (from Today's check-in), else today's.
  const [state, layout] = await Promise.all([loadTrainingState(supabase), loadLayout(supabase)]);
  const day = asked && DAY.test(asked) ? asked : state.today;
  const stored = day === state.today ? state.todayStored : ((await loadPlanDays(supabase, day, day))[0] ?? null);
  const session = sessionFor(state, day, stored);
  // Today's day-one card: an easy first ride, not tied to a plan day.
  if (first) {
    const saved = await loadCustomWorkouts(supabase).catch(() => []);
    return (
      <RideScreen
        key="first"
        initialFtp={state.athlete.ftp}
        ftpGuess={ftpIsGuess(state.athlete.ftpHistory, state.today)}
        canSave
        planned={firstRideSession(state)}
        plannedLabel="Your first ride"
        levels={state.levels}
        saved={saved}
        favorites={state.favorites}
        today={state.today}
        thresholdHr={state.athlete.thresholdHr}
        weightKg={state.athlete.weightKg}
        rideFields={layout.ride}
      />
    );
  }
  // My workouts is optional: the page still works before its table exists.
  const saved = await loadCustomWorkouts(supabase).catch(() => []);
  return (
    <RideScreen
      key={day}
      initialFtp={state.athlete.ftp}
      ftpGuess={ftpIsGuess(state.athlete.ftpHistory, state.today)}
      canSave
      planned={session}
      plannedDay={session ? day : undefined}
      plannedLabel={day === state.today ? "Today's plan" : `Plan for ${shortDay(day)}`}
      levels={state.levels}
      saved={saved}
      favorites={state.favorites}
      today={state.today}
      thresholdHr={state.athlete.thresholdHr}
      weightKg={state.athlete.weightKg}
      rideFields={layout.ride}
      initialSource={source === "library" || source === "custom" || source === "erg" ? source : undefined}
    />
  );
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
