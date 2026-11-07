// Race day: the warm-up, fuelling and timeline around an event's start, from its kind and length,
// your FTP and weight. Standard sports-nutrition and warm-up practice, scaled to you; the coach's
// brief adds the pacing and strategy.

import { goalIntensity, goalMinutes, type Goal, type GoalKind } from "./plan";

export interface WarmupStep {
  minutes: number;
  label: string;
  /** Watts as a range, when FTP is known. */
  watts: [number, number] | null;
}

export interface RaceMoment {
  /** Minutes from the start: negative before, positive after. */
  offset: number;
  label: string;
  detail?: string;
}

export interface RaceDay {
  warmup: WarmupStep[];
  warmupMinutes: number;
  /** Carbohydrate per hour while racing, grams; null when the race is too short to need it. */
  carbsPerHour: number | null;
  timeline: RaceMoment[];
}

/** Short, hard events get a full warm-up with openers; long, steady ones a short spin. */
const STYLE: Record<GoalKind, "full" | "medium" | "spin"> = {
  cyclocross: "full",
  criterium: "full",
  mountainBike: "full",
  track: "full",
  timeTrial: "full",
  hillClimb: "full",
  roadRace: "medium",
  gravel: "spin",
  granFondo: "spin",
};

const band = (ftp: number | null, low: number, high: number): [number, number] | null =>
  ftp ? [Math.round((ftp * low) / 5) * 5, Math.round((ftp * high) / 5) * 5] : null;

export function warmup(kind: GoalKind, ftp: number | null): WarmupStep[] {
  switch (STYLE[kind]) {
    case "full":
      return [
        { minutes: 8, label: "Easy, building", watts: band(ftp, 0.5, 0.7) },
        { minutes: 6, label: "3 × 1 min at threshold, 1 min easy between", watts: band(ftp, 0.98, 1.05) },
        { minutes: 4, label: "2 × 15 s race-start sprints, 2 min easy between", watts: null },
        { minutes: 4, label: "Easy spin, heart rate settles", watts: band(ftp, 0.45, 0.6) },
      ];
    case "medium":
      return [
        { minutes: 8, label: "Easy, building", watts: band(ftp, 0.5, 0.7) },
        { minutes: 4, label: "2 × 1 min at threshold, 1 min easy between", watts: band(ftp, 0.95, 1.02) },
        { minutes: 3, label: "Easy spin", watts: band(ftp, 0.45, 0.6) },
      ];
    case "spin":
      return [
        { minutes: 8, label: "Easy spin", watts: band(ftp, 0.5, 0.65) },
        { minutes: 2, label: "2 × 20 s pick-ups", watts: null },
      ];
  }
}

/**
 * Carbohydrate per hour while racing: none under 75 minutes (a gel before the start covers it),
 * 60 g/h for most, up to 90 g/h for long hard days if the gut is trained for it.
 */
export function carbsPerHour(goal: Goal): number | null {
  const minutes = goalMinutes(goal);
  if (minutes < 75) return null;
  const hard = goalIntensity(goal) === "hard" || goalIntensity(goal) === "max";
  return minutes >= 150 && hard ? 90 : 60;
}

/**
 * The meal three hours out, named for the time of day it falls at: an afternoon or evening start
 * comes after breakfast and lunch, so its meal is a pre-race meal. Unknown start: pre-race meal.
 */
export function mealLabel(start: string | null | undefined): string {
  if (!start) return "Pre-race meal";
  const [h, m] = start.split(":").map(Number);
  const meal = h * 60 + m - 180;
  return meal < 10 * 60 ? "Breakfast" : meal < 13 * 60 ? "Lunch" : "Pre-race meal";
}

/** The race day around `goal`'s start (its startTime, if set), for an athlete of `weightKg` (null if unknown). */
export function raceDay(goal: Goal, ftp: number | null, weightKg: number | null): RaceDay {
  const steps = warmup(goal.kind, ftp);
  const warmupMinutes = steps.reduce((sum, s) => sum + s.minutes, 0);
  const minutes = goalMinutes(goal);
  const perHour = carbsPerHour(goal);
  const grams = (perKg: number, fallback: string) => (weightKg ? `about ${Math.round((weightKg * perKg) / 10) * 10} g of carbohydrate` : fallback);
  const offroad = goal.kind === "cyclocross" || goal.kind === "gravel" || goal.kind === "mountainBike";
  // Warm-ups finish 10 minutes before the start, leaving time to get to the line.
  const warmupStart = -(warmupMinutes + 10);

  const timeline: RaceMoment[] = [
    { offset: -180, label: mealLabel(goal.startTime), detail: `${cap(grams(2, "a carbohydrate-rich meal"))}, low in fat and fibre, and 500 ml of fluid.` },
    {
      offset: -90,
      label: goal.kind === "cyclocross" ? "Arrive, sign on, pre-ride the course" : "Arrive and sign on",
      detail:
        goal.kind === "cyclocross"
          ? "A lap or two at easy pace when the course is open: lines, run-ups, where to pass. Set tyre pressure after."
          : offroad
            ? "Pin your number, check tyre pressure and bottles."
            : "Pin your number, check the bike and your bottles.",
    },
    { offset: -60, label: "Snack", detail: `${cap(grams(0.4, "a banana or bar"))} and a few sips of fluid.` },
    { offset: warmupStart, label: `Warm up, ${warmupMinutes} min`, detail: "On the trainer or rollers if you have them." },
    {
      offset: -10,
      label: "To the start",
      detail: minutes < 75 ? "A gel (about 25 g) with water as you roll to the line." : "Last sips; bottles and food in your pockets.",
    },
    { offset: 0, label: "Start" },
  ];
  if (perHour) {
    timeline.push({
      offset: 20,
      label: "Fuel while racing",
      detail: `${perHour} g of carbohydrate an hour, about ${Math.round(perHour / 3)} g every 20 minutes, and a bottle an hour (more in heat).`,
    });
  }
  timeline.push({
    offset: minutes,
    label: "Finish: cool down and refuel",
    detail: `10 minutes easy, then within 30 minutes ${grams(1, "a carbohydrate-rich snack")} with 20 to 30 g of protein.`,
  });
  return { warmup: steps, warmupMinutes, carbsPerHour: perHour, timeline: timeline.sort((a, b) => a.offset - b.offset) };
}

const cap = (text: string) => text[0].toUpperCase() + text.slice(1);

/** "10:45" plus minutes, as a clock time; wraps past midnight. */
export function clockAt(start: string, offset: number): string {
  const [h, m] = start.split(":").map(Number);
  const total = (((h * 60 + m + offset) % 1440) + 1440) % 1440;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "3 h before", "40 min before", "Start", "50 min in". */
export function relativeLabel(offset: number): string {
  if (offset === 0) return "Start";
  const abs = Math.abs(offset);
  const text = abs >= 60 && abs % 60 === 0 ? `${abs / 60} h` : abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return offset < 0 ? `${text} before` : `${text} in`;
}
