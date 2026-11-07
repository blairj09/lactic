// Body composition from weight and bioelectrical impedance.

export interface SegmentImpedance {
  rightArm: number;
  leftArm: number;
  trunk: number;
  rightLeg: number;
  leftLeg: number;
}

/** Rejects readings with poor contact (socks, not holding the bar): zero or absurd segments. */
export function impedanceIsValid(z: SegmentImpedance): boolean {
  return Object.values(z).every((ohms) => ohms > 0 && ohms < 3000);
}

/** Hand-to-foot impedance down the right side, which is what whole-body BIA equations expect. */
export const wholeBodyImpedance = (z: SegmentImpedance) => z.rightArm + z.trunk + z.rightLeg;

export interface BodyComposition {
  bmi: number;
  fatFreeMassKg: number | null;
  fatMassKg: number | null;
  bodyFatPercent: number | null;
}

/**
 * Fat-free mass from Sun et al. (2003), Am J Clin Nutr 77:331, a published equation built on a
 * large multi-ethnic sample against a four-compartment reference. Uses 50 kHz whole-body impedance.
 * Consumer-scale estimates: track the trend, not the absolute number.
 */
export function bodyComposition(input: { weightKg: number; heightCm: number; male: boolean; impedance50kHz?: SegmentImpedance | null }): BodyComposition {
  const { weightKg: w, heightCm: h, male } = input;
  const bmi = w / (h / 100) ** 2;
  const z = input.impedance50kHz;
  if (!z || !impedanceIsValid(z)) return { bmi, fatFreeMassKg: null, fatMassKg: null, bodyFatPercent: null };
  const r = wholeBodyImpedance(z);
  const index = (h * h) / r;
  const ffm = male ? -10.68 + 0.65 * index + 0.26 * w + 0.02 * r : -9.53 + 0.69 * index + 0.17 * w + 0.02 * r;
  const fatFreeMassKg = Math.min(Math.max(ffm, 0), w);
  return { bmi, fatFreeMassKg, fatMassKg: w - fatFreeMassKg, bodyFatPercent: ((w - fatFreeMassKg) / w) * 100 };
}

/** Whole years between a birth date and a day (both YYYY-MM-DD). */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export interface BodyPoint {
  measuredAt: Date;
  weightKg: number;
  bodyFatPercent: number | null;
}

/**
 * Change in weight and body fat over a window: the mean of the last 7 days of readings against the
 * mean of the 7 days ending `days` ago. Single weigh-ins swing with water, so both ends are averages.
 */
export function bodyTrend(points: BodyPoint[], now: Date, days = 30): { weightKg: number | null; bodyFatPercent: number | null } {
  const DAY = 86_400_000;
  const within = (end: number) => points.filter((p) => p.measuredAt.getTime() <= end && p.measuredAt.getTime() > end - 7 * DAY);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const recent = within(now.getTime());
  const earlier = within(now.getTime() - days * DAY);
  const change = (pick: (p: BodyPoint) => number | null) => {
    const a = mean(recent.map(pick).filter((v): v is number => v !== null));
    const b = mean(earlier.map(pick).filter((v): v is number => v !== null));
    return a === null || b === null ? null : a - b;
  };
  return { weightKg: change((p) => p.weightKg), bodyFatPercent: change((p) => p.bodyFatPercent) };
}
