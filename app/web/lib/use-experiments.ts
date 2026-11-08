"use client";

import { useSyncExternalStore } from "react";
import { experiments, EXPERIMENTS_EVENT, NO_EXPERIMENTS, type Experiments } from "./experiments";

function subscribe(onChange: () => void) {
  window.addEventListener(EXPERIMENTS_EVENT, onChange);
  return () => window.removeEventListener(EXPERIMENTS_EVENT, onChange);
}

/** Which experimental features are on, following changes from Settings. */
export function useExperiments(): Experiments {
  return useSyncExternalStore(subscribe, experiments, () => NO_EXPERIMENTS);
}
