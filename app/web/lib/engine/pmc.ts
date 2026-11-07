// Performance management chart: fitness (CTL), fatigue (ATL) and form (TSB).

export interface FitnessDay {
  /** Calendar day as YYYY-MM-DD. */
  date: string;
  stress: number;
  /** Chronic training load, 42-day exponentially weighted. */
  fitness: number;
  /** Acute training load, 7-day exponentially weighted. */
  fatigue: number;
  /** Yesterday's fitness minus yesterday's fatigue: how fresh you are coming into today. */
  form: number;
}

export interface PmcOptions {
  startingFitness?: number;
  startingFatigue?: number;
  fitnessDays?: number;
  fatigueDays?: number;
}

/** Daily series from `from` through `through` (YYYY-MM-DD, inclusive). Missing days count as zero stress. */
export function fitnessSeries(
  dailyStress: Record<string, number>,
  from: string,
  through: string,
  { startingFitness = 0, startingFatigue = 0, fitnessDays = 42, fatigueDays = 7 }: PmcOptions = {},
): FitnessDay[] {
  const result: FitnessDay[] = [];
  let fitness = startingFitness;
  let fatigue = startingFatigue;
  for (let day = from; day <= through; day = addDays(day, 1)) {
    const stress = dailyStress[day] ?? 0;
    const form = fitness - fatigue;
    fitness += (stress - fitness) / fitnessDays;
    fatigue += (stress - fatigue) / fatigueDays;
    result.push({ date: day, stress, fitness, fatigue, form });
  }
  return result;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Form's band, in one wording for every page: a word ("fresh") and a sentence on what it means. */
export function formBand(form: number): { word: string; meaning: string } {
  if (form > 15) return { word: "very fresh", meaning: "Very fresh. Fitness may be slipping if this lasts." };
  if (form > 5) return { word: "fresh", meaning: "Fresh. A good day for a hard session or a race." };
  if (form >= -10) return { word: "neutral", meaning: "Neutral. Normal training." };
  if (form >= -30) return { word: "tired from training", meaning: "Tired from productive training." };
  return { word: "very fatigued", meaning: "Very fatigued. Rest soon." };
}
