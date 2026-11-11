// Whether the tour is showing, and where it is. It starts once after setup and again from
// Settings → Getting started; "tour.done" remembers it was seen.

import { useSyncExternalStore } from "react";
import { setSetting } from "~/settings/store";

export const TOUR_DONE = "tour.done";

let step: number | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Starts at the intro card; pass FIRST_STOP when the rider just asked for the tour, so it doesn't ask again. */
export function startTour(at = 0) {
  if (step !== null) return;
  step = at;
  emit();
}

export function goToStep(at: number) {
  step = at;
  emit();
}

export async function endTour() {
  step = null;
  emit();
  await setSetting(TOUR_DONE, true);
}

export function useTourStep(): number | null {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => step,
  );
}
