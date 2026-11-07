// Deterministic checks, composed per scenario. Each returns null when it passes, or a short reason.

import type { PlanChange } from "@shared/coach/changes";
import type { OptionId } from "@shared/engine/checkin";
import type { Check, Transcript } from "./types";

const called = (t: Transcript) => t.calls.map((c) => c.name);
const words = (names: string[]) => names.join(" or ");

/** Calls at least one of these tools. */
export const calls = (...names: string[]): Check => (t) => (names.some((n) => called(t).includes(n)) ? null : `didn't call ${words(names)}`);

/** Calls none of these tools. */
export const neverCalls = (...names: string[]): Check => (t) => {
  const bad = names.filter((n) => called(t).includes(n));
  return bad.length ? `called ${bad.join(", ")}` : null;
};

/** The first tool it calls is one of these (look before advising). */
export const firstCalls = (...names: string[]): Check => (t) => {
  const first = t.calls[0]?.name;
  return first && names.includes(first) ? null : `first call was ${first ?? "none"}, not ${words(names)}`;
};

/** Proposes at least one change, of these kinds when given, all passing `test`. */
export const proposes = (kinds?: PlanChange["kind"][], test?: (c: PlanChange) => string | null): Check => (t) => {
  const changes = t.proposals.map((p) => p.change);
  if (!changes.length) return `proposed nothing${kinds ? ` (wanted ${words(kinds)})` : ""}`;
  const fit = kinds ? changes.filter((c) => kinds.includes(c.kind)) : changes;
  if (!fit.length) return `proposed ${changes.map((c) => c.kind).join(", ")}, not ${words(kinds!)}`;
  if (test) {
    const problems = fit.map(test).filter((p): p is string => Boolean(p));
    if (problems.length === fit.length) return problems[0];
  }
  return null;
};

/** Proposes nothing (or nothing of these kinds). */
export const proposesNothing = (kinds?: PlanChange["kind"][]): Check => (t) => {
  const bad = t.proposals.filter((p) => !kinds || kinds.includes(p.change.kind));
  return bad.length ? `proposed ${bad.map((p) => p.summary).join("; ")}` : null;
};

/** Every proposal passes `test`. */
export const everyProposal = (test: (c: PlanChange) => string | null): Check => (t) => {
  for (const p of t.proposals) {
    const problem = test(p.change);
    if (problem) return problem;
  }
  return null;
};

export const remembers: Check = (t) => (t.memory.some((m) => m.op === "add") ? null : "saved nothing to memory");
export const forgets = (id: string): Check => (t) => (t.memory.some((m) => m.op === "remove" && m.id === id) ? null : `didn't forget ${id}`);
export const remembersNothing: Check = (t) => (t.memory.length ? `changed memory: ${JSON.stringify(t.memory)}` : null);

/** The brief suggests one of these options for today. */
export const suggestsToday = (...ids: OptionId[]): Check => (t) => (t.today && ids.includes(t.today) ? null : `suggested ${t.today ?? "nothing"} for today, not ${words(ids)}`);

/** The weekly run picks a workout for each of these dates. */
export const picksEvery = (dates: string[]): Check => (t) => {
  const missing = dates.filter((d) => !t.picks.some((p) => p.date === d));
  return missing.length ? `no pick for ${missing.join(", ")}` : null;
};

const asPattern = (p: string | RegExp) => (typeof p === "string" ? new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : p);

/** The reply contains every one of these. */
export const mentions = (...patterns: (string | RegExp)[]): Check => (t) => {
  const missing = patterns.filter((p) => !asPattern(p).test(t.reply));
  return missing.length ? `doesn't mention ${missing.map(String).join(", ")}` : null;
};

/** The reply contains at least one of these. */
export const mentionsAny = (...patterns: (string | RegExp)[]): Check => (t) => (patterns.some((p) => asPattern(p).test(t.reply)) ? null : `mentions none of ${patterns.map(String).join(", ")}`);

/** The reply contains none of these. */
export const avoids = (...patterns: (string | RegExp)[]): Check => (t) => {
  const hit = patterns.find((p) => asPattern(p).test(t.reply));
  return hit ? `says ${String(hit)}: "${t.reply.match(asPattern(hit))?.[0]}"` : null;
};

/** Every number in the reply was in what the model was shown. On for every scenario. */
export const grounded: Check = (t) => {
  const bad = ungroundedNumbers(t.reply, t.context);
  return bad.length ? `numbers not in the data: ${bad.join(", ")}` : null;
};

/** Tool calls that came back as errors (bad arguments, unknown tools), at most `max`. */
export const toolErrorsAtMost = (max: number): Check => (t) => {
  const errors = t.calls.filter((c) => c.result.startsWith("Error") || c.result.startsWith("Unknown tool"));
  return errors.length > max ? `${errors.length} tool calls failed (${errors.map((e) => e.name).join(", ")})` : null;
};

/**
 * Numbers in the reply that don't appear in what the model was shown, allowing for rounding. Dates,
 * times, small whole numbers (counts like "3 intervals") and numbers in a range's or percentage's
 * own wording that the context has are skipped.
 */
export function ungroundedNumbers(reply: string, context: string): string[] {
  const known = (context.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const text = reply
    .replace(/\b\d{4}-\d\d-\d\d\b/g, " ")
    .replace(/\b\d{1,2}:\d\d(?::\d\d)?\b/g, " ")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?\b/gi, " ")
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, " ")
    .replace(/\b(?:19|20)\d\d\b/g, " ");
  const found = text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  return [
    ...new Set(
      found.filter((raw) => {
        const n = Number(raw.replace(/,/g, ""));
        if (Number.isInteger(n) && n <= 10) return false;
        const tolerance = raw.includes(".") ? 0.051 : 0.5;
        // Durations: "2 hours" may be 120 minutes or 7200 seconds in the data.
        const forms = [n, n * 60, n * 3600, n / 60];
        return !known.some((k) => forms.some((f) => Math.abs(Math.abs(k) - f) <= tolerance));
      }),
    ),
  ];
}
