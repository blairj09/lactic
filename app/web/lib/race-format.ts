// Race report numbers in the rider's units.

import type { Formatters } from "./engine/race/advice";
import { speedIn, speedUnit, type UnitSystem } from "./units";

export function raceFormatters(units: UnitSystem): Formatters {
  return {
    speed: (mps) => `${speedIn(mps, units).toFixed(1)} ${speedUnit(units)}`,
    speedDiff: (mps) => `${Math.abs(speedIn(mps, units)).toFixed(1)} ${speedUnit(units)}`,
  };
}

/** "+12.3 s" for time lost, "−4.1 s" for time gained. */
export function signedSeconds(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "–";
  const v = Math.round(s * 10) / 10;
  if (v === 0) return "0.0 s";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)} s`;
}
