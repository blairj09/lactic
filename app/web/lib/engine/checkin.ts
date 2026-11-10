// The morning check-in: today's recovery, form and how you feel decide whether to ride the plan
// as written, ease off, or push. The engine builds every option; the coach only explains and picks.

import { buildSession, MAX_LEVEL, MIN_LEVEL, type Session } from "./library";
import { MAX_SIGNAL_STRAIN } from "./recovery-glance";

/** 1 wrecked, 2 tired, 3 normal, 4 good, 5 great. */
export type Feel = 1 | 2 | 3 | 4 | 5;

export const FEEL_LABELS: Record<Feel, string> = { 1: "Wrecked", 2: "Tired", 3: "Normal", 4: "Good", 5: "Great" };

export interface CheckinInput {
  /** Today's planned session, or null on a rest day. */
  planned: Session | null;
  /** 0 to 100, or null when there's no score yet. */
  recovery: number | null;
  /** Fitness minus fatigue coming into today. */
  form: number;
  fitness: number;
  feel: Feel;
  /** Feeling ill: always rest. */
  sick?: boolean;
  /** Minutes available today, when less (or more) than planned. */
  minutes?: number;
  /** What recent post-ride surveys say (feedbackStrain in feedback.ts). */
  feedback?: { strain: number; reason: string | null };
  /** Yesterday's exertion off the bike (TRIMP), which form doesn't see: a hike, a day on your feet. */
  offBikeTrimp?: number;
  /** Warning signs across recent nights (recoverySignals in recovery-glance.ts): a run of low HRV, signs of illness, sleep debt. */
  signals?: { strain: number; reason: string }[];
}

/** Off-bike TRIMP that counts as a big day: about an hour's endurance ride. */
export const BIG_OFF_BIKE_TRIMP = 80;

export type OptionId = "asPlanned" | "harder" | "easier" | "shorter" | "endurance" | "recovery" | "rest";

export interface CheckinOption {
  id: OptionId;
  label: string;
  /** Null means rest. */
  session: Session | null;
}

export interface CheckinResult {
  /** The engine's pick. The coach can choose another option from the list, with a reason. */
  recommended: OptionId;
  /** Positive is a reason to back off, negative a reason to push. */
  strain: number;
  reasons: string[];
  options: CheckinOption[];
}

const INTENSE = new Set(["tempo", "sweetSpot", "threshold", "vo2max", "anaerobic"]);

/**
 * Adds up warning signs (poor recovery, deep fatigue, feeling bad, recent workouts too hard, a big
 * day off the bike, runs of poor nights) against
 * good signs, then:
 * 4+ rest, 3 swap to easy riding, 2 a level easier, 0 to 1 as planned, -2 or better offers harder.
 */
export function checkin(input: CheckinInput): CheckinResult {
  const { planned, recovery, form, feel } = input;
  const reasons: string[] = [];
  let strain = 0;

  if (recovery !== null) {
    if (recovery < 34) {
      strain += 2;
      reasons.push(`Recovery is low (${recovery})`);
    } else if (recovery < 45) {
      strain += 1;
      reasons.push(`Recovery is below normal (${recovery})`);
    } else if (recovery >= 67) {
      strain -= 1;
      reasons.push(`Recovery is high (${recovery})`);
    }
  }
  // Form is relative to fitness: -20 means more at fitness 40 than at fitness 90.
  const relativeForm = form / Math.max(input.fitness, 30);
  if (relativeForm < -0.5) {
    strain += 2;
    reasons.push(`Very fatigued (form ${Math.round(form)})`);
  } else if (relativeForm < -0.3) {
    strain += 1;
    reasons.push(`Carrying fatigue (form ${Math.round(form)})`);
  } else if (relativeForm > 0.1) {
    strain -= 1;
    reasons.push(`Fresh (form +${Math.round(form)})`);
  }
  if (feel === 1) strain += 3;
  else if (feel === 2) strain += 1;
  else if (feel === 5) strain -= 1;
  if (feel !== 3) reasons.push(`You feel ${feelWord(feel)}`);
  if (input.feedback?.reason) {
    strain += input.feedback.strain;
    reasons.push(input.feedback.reason);
  }
  if (input.offBikeTrimp !== undefined && input.offBikeTrimp >= BIG_OFF_BIKE_TRIMP) {
    strain += 1;
    reasons.push("A big day off the bike yesterday");
  }
  if (input.signals?.length) {
    strain += Math.min(input.signals.reduce((a, x) => a + x.strain, 0), MAX_SIGNAL_STRAIN);
    reasons.push(...input.signals.map((x) => x.reason));
  }
  if (input.sick) reasons.unshift("You're feeling ill");

  const options = buildOptions(planned, input.minutes);
  const has = (id: OptionId) => options.some((o) => o.id === id);
  const intense = planned !== null && INTENSE.has(planned.zone);

  let recommended: OptionId;
  if (input.sick || strain >= 4) recommended = "rest";
  else if (strain === 3) recommended = intense ? "endurance" : planned ? "recovery" : "rest";
  else if (strain === 2) recommended = intense ? "easier" : planned ? "shorter" : "rest";
  else if (strain <= -2 && intense && has("harder")) recommended = "harder";
  else recommended = planned ? "asPlanned" : "rest";
  // Less time than planned: the shorter version of whatever was chosen.
  if (recommended === "asPlanned" && has("shorter") && input.minutes !== undefined && planned && input.minutes * 60 < planned.duration) recommended = "shorter";
  if (!has(recommended)) recommended = planned ? "asPlanned" : "rest";

  return { recommended, strain, reasons, options };
}

function buildOptions(planned: Session | null, minutes?: number): CheckinOption[] {
  const options: CheckinOption[] = [];
  if (planned) {
    const duration = planned.duration;
    const intense = INTENSE.has(planned.zone);
    // Harder, easier and shorter keep the workout's structure and any targets set on it.
    const same = { template: planned.template, tweaks: planned.tweaks };
    options.push({ id: "asPlanned", label: "Ride it as planned", session: planned });
    if (intense && planned.level < MAX_LEVEL) {
      options.push({ id: "harder", label: "A level harder", session: buildSession(planned.zone, Math.min(MAX_LEVEL, planned.level + 1), duration, same) });
    }
    if (intense && planned.level > MIN_LEVEL) {
      options.push({ id: "easier", label: "A level easier", session: buildSession(planned.zone, Math.max(MIN_LEVEL, planned.level - 1.5), duration, same) });
    }
    const short = minutes !== undefined && minutes * 60 < duration ? minutes * 60 : Math.round((duration * 0.67) / 300) * 300;
    if (short >= 1200 && short < duration) options.push({ id: "shorter", label: `Shorter (${Math.round(short / 60)} min)`, session: buildSession(planned.zone, planned.level, short, same) });
    if (intense) options.push({ id: "endurance", label: "Swap to endurance", session: buildSession("endurance", 3, Math.min(duration, 75 * 60)) });
  }
  options.push({ id: "recovery", label: "Recovery spin", session: buildSession("recovery", 1, Math.min(minutes ?? 45, 45) * 60) });
  options.push({ id: "rest", label: "Take the day off", session: null });
  return options;
}

const feelWord = (feel: Feel) => FEEL_LABELS[feel].toLowerCase();
