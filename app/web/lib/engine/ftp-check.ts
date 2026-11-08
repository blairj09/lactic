// When FTP needs a look: a test that's getting old, or rides that say it's gone up. Rule-based, from
// FTP history and the estimate from recent rides (ftp.ts); the rider decides, with one click.

import type { FtpChange } from "./activity";
import type { FtpEstimate } from "./ftp";
import { MIN_SESSION_MINUTES, type DayRole, type Plan } from "./plan";
import { addDays } from "./pmc";

/** A test older than this is stale: eight weeks is about one training block. */
export const RETEST_AFTER_DAYS = 56;
/** An estimate this share above FTP (and at least MIN_GAIN_WATTS) means FTP looks higher. */
export const HIGHER_SHARE = 0.03;
export const MIN_GAIN_WATTS = 5;
/** How far ahead a retest is scheduled, and how near a planned test makes the nudge pointless. */
export const RETEST_WINDOW_DAYS = 7;

/** FTP changes that came from a test: a ramp test ridden here, or one you entered yourself. */
const TESTED = new Set(["rampTest", "manual"]);
/** The method setup records when the rider doesn't know their FTP and starts from a guess from weight. */
export const GUESS_METHOD = "guess";

/** Whether FTP is still setup's guess: the latest change by `today` is a guess, so the first test should set it. */
export function ftpIsGuess(history: FtpChange[], today: string): boolean {
  const latest = history.filter((h) => h.effectiveDate <= today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  return latest?.method === GUESS_METHOD;
}

export interface FtpCheck {
  /** The last test, and how many days ago; set when it's older than RETEST_AFTER_DAYS (or there's none). */
  stale: { lastTest: string | null; days: number | null; guess: boolean } | null;
  /** The estimate when it's clearly above FTP. */
  higher: { watts: number; gain: number; method: FtpEstimate["method"] } | null;
  /** An estimate applied today, with the FTP before it, so it can be undone. */
  applied: { watts: number; previous: number | null } | null;
}

/** FTP changes that were estimates from rides, as the "FTP looks higher" banner applies them. */
const ESTIMATED = new Set(["criticalPower", "twentyMinute"]);

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Whether to suggest a retest and whether FTP looks higher. No retest nudge without an FTP, or when the
 * plan has a test in the next RETEST_WINDOW_DAYS. A higher estimate isn't offered in the week after an
 * FTP change, while the rides behind it are still from the old FTP.
 */
export function checkFtp(input: { today: string; ftp: number | null; history: FtpChange[]; estimate: FtpEstimate | null; plan: Plan | null }): FtpCheck {
  const { today, ftp, history, estimate } = input;
  if (!ftp) return { stale: null, higher: null, applied: null };
  const tests = history.filter((h) => h.method && TESTED.has(h.method) && h.effectiveDate <= today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const lastTest = tests[0]?.effectiveDate ?? null;
  const days = lastTest ? daysBetween(lastTest, today) : null;
  const testAhead = input.plan?.weeks.some((w) => w.days.some((d) => d.role === "test" && d.date >= today && d.date <= addDays(today, RETEST_WINDOW_DAYS)));
  const stale = !testAhead && (days === null || days > RETEST_AFTER_DAYS) ? { lastTest, days, guess: ftpIsGuess(history, today) } : null;

  const lastChange = history.filter((h) => h.effectiveDate <= today).reduce<string | null>((latest, h) => (!latest || h.effectiveDate > latest ? h.effectiveDate : latest), null);
  const settled = !lastChange || daysBetween(lastChange, today) >= 7;
  const gain = estimate ? Math.round(estimate.watts) - ftp : 0;
  const higher = estimate && settled && gain >= MIN_GAIN_WATTS && gain >= ftp * HIGHER_SHARE ? { watts: Math.round(estimate.watts), gain, method: estimate.method } : null;
  const todays = history.find((h) => h.effectiveDate === today);
  const before = history.filter((h) => h.effectiveDate < today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  const applied = todays?.method && ESTIMATED.has(todays.method) ? { watts: todays.watts, previous: before?.watts ?? null } : null;
  return { stale, higher, applied };
}

const EASY: DayRole[] = ["easy", "rest", "long"];
const HARD: DayRole[] = ["key", "test", "event", "openers"];

/**
 * The day to put a ramp test on, in the next RETEST_WINDOW_DAYS from `today` (tomorrow, once today is
 * ridden), always on a day with time to ride that follows no hard day, so you come to it fresh. Best
 * is an easy day with no hard day after it either; else the test takes the place of a key session, so
 * the week gets no harder. Null if neither fits.
 */
export function retestDay(plan: Plan, today: string, minutes: (date: string) => number, riddenToday: boolean): string | null {
  const days = new Map(plan.weeks.flatMap((w) => w.days).map((d) => [d.date, d]));
  const hard = (date: string) => {
    const role = days.get(date)?.role;
    return role !== undefined && HARD.includes(role);
  };
  const candidates: string[] = [];
  for (let k = riddenToday ? 1 : 0; k <= RETEST_WINDOW_DAYS; k++) {
    const date = addDays(today, k);
    if (days.has(date) && minutes(date) >= MIN_SESSION_MINUTES && !hard(addDays(date, -1))) candidates.push(date);
  }
  const role = (date: string) => days.get(date)!.role;
  return candidates.find((d) => EASY.includes(role(d)) && !hard(addDays(d, 1))) ?? candidates.find((d) => role(d) === "key") ?? null;
}

/**
 * The day for a new rider's first ramp test, when FTP is only a guess: the first day from `today` (tomorrow,
 * once today is ridden) in the next RETEST_WINDOW_DAYS with time to ride, no hard day before it, and no
 * event or openers on it. Sessions are set from FTP, so the sooner the test, the sooner they fit. Null if
 * none fits.
 */
export function firstTestDay(plan: Plan, today: string, minutes: (date: string) => number, riddenToday: boolean): string | null {
  const days = new Map(plan.weeks.flatMap((w) => w.days).map((d) => [d.date, d]));
  const hard = (date: string) => {
    const role = days.get(date)?.role;
    return role !== undefined && HARD.includes(role);
  };
  for (let k = riddenToday ? 1 : 0; k <= RETEST_WINDOW_DAYS; k++) {
    const date = addDays(today, k);
    const day = days.get(date);
    if (!day || day.break || day.role === "event" || day.role === "openers") continue;
    if (minutes(date) >= MIN_SESSION_MINUTES && !hard(addDays(date, -1))) return date;
  }
  return null;
}
