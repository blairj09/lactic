// VO2 max and fitness age. VO2 max is estimated from your best 5-minute power (or taken from Apple
// Health), and fitness age is the age whose average VO2 max matches yours.

/**
 * VO2 max (ml/kg/min) from the best 5-minute power: the ACSM cycling equation, 10.8 × W/kg + 7,
 * with 5-minute power standing in for the power at VO2 max.
 */
export function vo2maxFromPower(fiveMinuteWatts: number, weightKg: number): number | null {
  if (!(fiveMinuteWatts > 0) || !(weightKg > 0)) return null;
  return Math.round((10.8 * (fiveMinuteWatts / weightKg) + 7) * 10) / 10;
}

// Mean measured VO2 peak by age band in the HUNT fitness study (Loe et al., 2013, PLoS One 8:e64319),
// at each band's midpoint.
const NORMS: Record<"male" | "female", [number, number][]> = {
  male: [[25, 54.4], [35, 49.0], [45, 47.7], [55, 42.6], [65, 39.0], [75, 35.0]],
  female: [[25, 43.0], [35, 40.0], [45, 38.4], [55, 34.4], [65, 31.0], [75, 28.0]],
};

/** The average VO2 max at an age, interpolated between bands and carried on the end slopes. */
export function averageVo2max(age: number, sex: "male" | "female"): number {
  const n = NORMS[sex];
  let i = n.findIndex(([a]) => a > age) - 1;
  if (i < 0) i = age < n[0][0] ? 0 : n.length - 2;
  const [[a0, v0], [a1, v1]] = [n[i], n[i + 1]];
  return v0 + ((age - a0) / (a1 - a0)) * (v1 - v0);
}

export const FITNESS_AGE_MIN = 20;
export const FITNESS_AGE_MAX = 90;

/** The age whose average VO2 max is `vo2max`, kept to 20 to 90. */
export function fitnessAge(vo2max: number, sex: "male" | "female"): number {
  // averageVo2max falls with age, so walk down it.
  for (let age = FITNESS_AGE_MIN; age <= FITNESS_AGE_MAX; age += 0.5) if (averageVo2max(age, sex) <= vo2max) return Math.round(age);
  return FITNESS_AGE_MAX;
}

/** Where a VO2 max sits against your age's average, in words. */
export function vo2maxRating(vo2max: number, age: number, sex: "male" | "female"): string {
  const ratio = vo2max / averageVo2max(age, sex);
  if (ratio >= 1.35) return "Elite for your age";
  if (ratio >= 1.2) return "Excellent for your age";
  if (ratio >= 1.07) return "Above average for your age";
  if (ratio >= 0.93) return "Average for your age";
  return "Below average for your age";
}

/** The VO2 max where each rating starts at an age, lowest first (the cuts `vo2maxRating` uses). */
export function vo2maxBands(age: number, sex: "male" | "female"): { label: string; from: number }[] {
  const average = averageVo2max(age, sex);
  const at = (ratio: number) => Math.round(average * ratio * 10) / 10;
  return [
    { label: "Below average", from: 0 },
    { label: "Average", from: at(0.93) },
    { label: "Above average", from: at(1.07) },
    { label: "Excellent", from: at(1.2) },
    { label: "Elite", from: at(1.35) },
  ];
}
