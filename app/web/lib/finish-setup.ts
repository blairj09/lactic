// "Finish setting up": the parts of setup a new rider leaves for later so they can ride first.
// The first run asks only FTP, weight and the trainer; these wait on Today until done or hidden.

/** True while Today shows the list (set at the end of the first run; existing riders never see it). */
export const FINISH_SETUP = "setup.finish";
/** The later steps the rider has saved. */
export const FINISH_SETUP_DONE = "setup.finish.done";

export type LaterStep = "week" | "rides" | "track" | "coach";

export const LATER_STEPS: { id: LaterStep; label: string; until: string }[] = [
  { id: "week", label: "Your week and goal", until: "Starter plan for now" },
  { id: "rides", label: "Bring in your rides", until: "" },
  { id: "track", label: "Sleep and weight", until: "Off" },
  { id: "coach", label: "Coach", until: "None" },
];

/** Which later steps are done: the ones saved, plus rides once there are any (imported or ridden here). */
export function setupDone(
  saved: readonly string[],
  { hasRides }: { hasRides: boolean },
): Set<LaterStep> {
  const done = new Set(
    LATER_STEPS.map((s) => s.id).filter((id) => saved.includes(id)),
  );
  if (hasRides) done.add("rides");
  return done;
}

type Get = <T>(key: string, fallback: T) => Promise<T>;
type Set_ = (key: string, value: unknown) => Promise<void>;

/** Ticks a step off the list. */
export async function markSetupDone(id: LaterStep, get: Get, set: Set_) {
  const saved = await get<string[]>(FINISH_SETUP_DONE, []);
  if (!saved.includes(id)) await set(FINISH_SETUP_DONE, [...saved, id]);
}
