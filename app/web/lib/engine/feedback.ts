// After a ride: was it the right difficulty, and how hard did it feel (RPE 1 to 10)? The answers
// move progression levels (levels.ts) and nudge the next check-in (checkin.ts).

import { addDays } from "./pmc";

export const DIFFICULTIES = ["tooEasy", "right", "tooHard", "failed"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  tooEasy: "Too easy",
  right: "About right",
  tooHard: "Too hard",
  failed: "Couldn't finish",
};

/** Borg CR10 words for each rating of perceived exertion. */
export const RPE_LABELS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Moderate",
  4: "Somewhat hard",
  5: "Hard",
  6: "Hard",
  7: "Very hard",
  8: "Very hard",
  9: "Extremely hard",
  10: "Max effort",
};

export interface RideAnswer {
  /** YYYY-MM-DD, local. */
  date: string;
  difficulty: Difficulty;
  rpe: number | null;
}

/** How long recent answers count toward the check-in. */
const RECENT_DAYS = 7;

/**
 * What recent rides say about today. Not finishing the last workout, or two of the last three
 * feeling too hard, is a reason to back off (+1). The last two both too easy is a reason to push
 * (-1). Answers are newest first.
 */
export function feedbackStrain(answers: RideAnswer[], today: string): { strain: number; reason: string | null } {
  const since = addDays(today, -RECENT_DAYS);
  const recent = answers.filter((a) => a.date >= since && a.date <= today).slice(0, 3);
  if (recent.length === 0) return { strain: 0, reason: null };
  if (recent[0].difficulty === "failed") return { strain: 1, reason: "You couldn't finish your last workout" };
  if (recent.filter((a) => a.difficulty === "tooHard" || a.difficulty === "failed").length >= 2) return { strain: 1, reason: "Recent workouts have felt too hard" };
  if (recent.length >= 2 && recent[0].difficulty === "tooEasy" && recent[1].difficulty === "tooEasy") return { strain: -1, reason: "Your last two workouts felt too easy" };
  return { strain: 0, reason: null };
}
