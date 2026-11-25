// "Finish setting up": the parts of setup a new rider leaves for later so they can ride first.
// The first run asks only FTP, weight and the trainer; these wait on Today until done or hidden.

/** True while Today shows the list (set at the end of the first run; existing riders never see it). */
export const FINISH_SETUP = "setup.finish";
/** The later steps the rider has saved. */
export const FINISH_SETUP_DONE = "setup.finish.done";

export type LaterStep = "week" | "rides" | "track" | "coach" | "phone";

export const LATER_STEPS: { id: LaterStep; label: string; until: string; computerOnly?: boolean }[] = [
  { id: "week", label: "Your week and goal", until: "Starter plan for now" },
  { id: "rides", label: "Bring your training", until: "From Zwift, Garmin, Strava…" },
  { id: "track", label: "Sleep and weight", until: "Off" },
  { id: "coach", label: "Coach", until: "None" },
  // Offered in the first run too; skipped there, it waits here.
  { id: "phone", label: "Your phone", until: "Not paired", computerOnly: true },
];

/** The later steps this device shows: pairing a phone only on the desktop app on a computer. */
export function laterSteps(computer: boolean) {
  return LATER_STEPS.filter((s) => computer || !s.computerOnly);
}

/**
 * Which later steps are done: the ones saved, plus rides once there are any (imported or ridden
 * here) and the phone once one is paired.
 */
export function setupDone(
  saved: readonly string[],
  { hasRides, phonePaired = false }: { hasRides: boolean; phonePaired?: boolean },
): Set<LaterStep> {
  const done = new Set(
    LATER_STEPS.map((s) => s.id).filter((id) => saved.includes(id)),
  );
  if (hasRides) done.add("rides");
  if (phonePaired) done.add("phone");
  return done;
}

type Get = <T>(key: string, fallback: T) => Promise<T>;
type Set_ = (key: string, value: unknown) => Promise<void>;

/** Ticks a step off the list. */
export async function markSetupDone(id: LaterStep, get: Get, set: Set_) {
  const saved = await get<string[]>(FINISH_SETUP_DONE, []);
  if (!saved.includes(id)) await set(FINISH_SETUP_DONE, [...saved, id]);
}
