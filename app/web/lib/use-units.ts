"use client";

import { useSyncExternalStore } from "react";
import { readUnits, UNITS_EVENT, UNITS_KEY, type UnitSystem } from "./units";

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === UNITS_KEY) onChange();
  };
  window.addEventListener(UNITS_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(UNITS_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The rider's units, following changes from Settings or the coach. */
export function useUnits(): UnitSystem {
  return useSyncExternalStore(subscribe, readUnits, () => "metric");
}
