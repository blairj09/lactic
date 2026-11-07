import { POWER_ZONE_LIMITS } from "./workout";

/** Upper limits of Coggan heart rate zones 1 to 4, as fractions of threshold HR. Zone 5 is everything above. */
export const HR_ZONE_LIMITS = [0.69, 0.84, 0.95, 1.06];

export const POWER_ZONE_NAMES = ["Active recovery", "Endurance", "Tempo", "Threshold", "VO2 max", "Anaerobic", "Neuromuscular"];
export const HR_ZONE_NAMES = ["Recovery", "Endurance", "Tempo", "Threshold", "VO2 max"];

export interface ZoneRange {
  zone: number;
  name: string;
  /** Lowest whole value in the zone; 0 for zone 1. */
  low: number;
  /** Highest whole value in the zone; null when the top zone is open-ended. */
  high: number | null;
}

/**
 * Whole-number ranges for zones whose upper limits are fractions of `base`. Each zone starts where
 * the one below ends, so the ranges never overlap. `top` caps the last zone (max HR).
 */
export function zoneRanges(limits: number[], names: string[], base: number, top: number | null = null): ZoneRange[] {
  const edges = limits.map((f) => Math.round(f * base));
  return names.map((name, i) => ({
    zone: i + 1,
    name,
    low: i === 0 ? 0 : edges[i - 1],
    high: i < edges.length ? edges[i] - 1 : top !== null && top >= edges[edges.length - 1] ? top : null,
  }));
}

/** Coggan power zones from FTP, in watts. */
export const powerZones = (ftp: number): ZoneRange[] => zoneRanges(POWER_ZONE_LIMITS, POWER_ZONE_NAMES, ftp);

/** Coggan heart rate zones from threshold HR, in bpm, with zone 5 capped at max HR when known. */
export const hrZones = (thresholdHr: number, maxHr: number | null = null): ZoneRange[] =>
  zoneRanges(HR_ZONE_LIMITS, HR_ZONE_NAMES, thresholdHr, maxHr);
