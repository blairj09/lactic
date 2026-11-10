// Race report numbers in the rider's units.

import type { Formatters } from "./engine/race/advice";
import type { SoloFormatters } from "./engine/race/solo-advice";
import type { CourseFormatters } from "./engine/course/prerace";
import { distanceIn, distanceUnit, formatDistance, formatElevation, speedIn, speedUnit, temperatureUnit, type UnitSystem } from "./units";

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

/** "km 122" / "mile 76", and "325 km" / "202 mi", for a race that isn't laps. */
export function soloFormatters(units: UnitSystem): SoloFormatters {
  return {
    at: (m) => `${units === "imperial" ? "mile" : "km"} ${Math.round(distanceIn(m, units))}`,
    distance: (m) => formatDistance(m, units, 0),
  };
}

export const distanceLabel = (units: UnitSystem) => distanceUnit(units);

/** Course and pre-race report numbers in the rider's units. */
export function courseFormatters(units: UnitSystem): CourseFormatters {
  const d = (m: number) => distanceIn(m, units).toFixed(1);
  return {
    at: (m) => `${units === "imperial" ? "mile" : "km"} ${d(m)}`,
    distance: (m) => `${d(m)} ${distanceUnit(units)}`,
    height: (m) => formatElevation(m, units),
    wind: (kmh) => `${Math.round(speedIn(kmh / 3.6, units))} ${speedUnit(units)}`,
    temp: (c) => `${Math.round(units === "imperial" ? c * 1.8 + 32 : c)}${temperatureUnit(units)}`,
  };
}
