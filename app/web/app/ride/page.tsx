import { STARTING_LEVELS } from "@/lib/engine/library";
import { loadCustomWorkouts } from "@/lib/custom-workouts";
import { ftpIsGuess } from "@/lib/engine/ftp-check";
import { authEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { loadPlanDays, loadTrainingState, sessionFor } from "@/lib/training";
import { firstRideSession } from "@/lib/first-ride";
import { loadLayout } from "@/lib/layout-data";
import { experiments } from "@/lib/experiments";
import { loadCourse } from "@/lib/course";
import { courseProfile } from "@/lib/engine/course/profile";
import { bikeSetup } from "@/lib/engine/course/pacing";
import { sectionById, sectionSeconds } from "@/lib/ride/course-ride";
import RideScreen, { type CourseRide } from "./ride-screen";

export const metadata = { title: "Ride · My Coach" };
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d\d-\d\d$/;

export default async function RidePage({ searchParams }: { searchParams: Promise<{ day?: string; source?: string; first?: string; workout?: string; course?: string; section?: string }> }) {
  if (!authEnabled) return <RideScreen initialFtp={null} canSave={false} levels={STARTING_LEVELS} />;
  const supabase = await createClient();
  const { day: asked, source, first, workout, course: courseId, section: sectionId } = await searchParams;
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
  // Ride part of an event's course (from its pre-race report): the trainer follows the road.
  let course: CourseRide | undefined;
  const goal = courseId && experiments().course_prep ? state.goals.find((g) => g.id === courseId) : undefined;
  if (goal) {
    const stored = await loadCourse(supabase, goal.id).catch(() => null);
    const profile = stored ? courseProfile(stored.track) : null;
    const section = profile ? (sectionById(profile, sectionId) ?? sectionById(profile, "course")) : null;
    if (profile && section && profile.hasElevation) {
      const setup = bikeSetup(goal.kind);
      const rider = { massKg: (state.athlete.weightKg ?? 75) + setup.bikeKg, setup };
      // Sized at an endurance pace, so the ride doesn't run out before the road does.
      const seconds = sectionSeconds(profile, section, Math.round((state.athlete.ftp ?? 200) * 0.6), rider);
      course = { goalId: goal.id, eventName: goal.name, profile, section, rider, seconds };
    }
  }
  return (
    <RideScreen
      key={`${day}:${workout ?? ""}:${course ? `${course.goalId}:${course.section.id}` : ""}`}
      course={course}
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
      initialSource={source === "library" || source === "custom" || source === "erg" || source === "headUnit" ? source : undefined}
      initialWorkout={workout}
    />
  );
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
