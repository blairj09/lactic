"use client";

import { useSyncExternalStore } from "react";
import { ALL_FEATURES, features, FEATURES_EVENT, type Features } from "./features";

function subscribe(onChange: () => void) {
  window.addEventListener(FEATURES_EVENT, onChange);
  return () => window.removeEventListener(FEATURES_EVENT, onChange);
}

/** What the rider tracks, following changes from Settings or the coach. */
export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, features, () => ALL_FEATURES);
}
