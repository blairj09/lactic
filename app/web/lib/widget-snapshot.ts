// What the iPhone's home and lock screen widgets show: last night's recovery and today's ride,
// already worded and formatted, so the widget (Swift, src-tauri/ios/widgets) only lays it out.
// Every number is the engine's; this picks and words them. Written by the app after each Health
// read and sync (src/phone/widget.ts).

import { formatHours } from "@/lib/engine/hours";
import { localDate } from "./engine/activity";
import { ZONE_LABELS } from "./engine/library";
import { MINIMUM_BASELINE_DAYS, recoveryWord } from "./engine/recovery";
import type { ExertionToday, GlanceKey } from "./engine/recovery-glance";
import type { TrainingState } from "./training";

export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetSnapshot {
  v: number;
  /** When it was made (ISO), and the rider's day it's for (YYYY-MM-DD). The widget greys it out on a later day. */
  at: string;
  day: string;
  recovery: {
    /** 0 to 100; null while the baseline is still building. */
    score: number | null;
    /** "Recovered", "Normal", "Under-recovered". */
    word: string | null;
    /** The main reason, or how far the baseline has to go. */
    reason: string | null;
    /** The last 7 mornings, oldest first. */
    week: (number | null)[];
  } | null;
  /** HRV, resting heart rate and sleep, last night. */
  metrics: { key: string; label: string; value: string; concern: boolean }[];
  sleepScore: number | null;
  /** The first warning sign (a run of low HRV nights, signs of illness, sleep debt). */
  signal: string | null;
  today: { title: string; detail: string | null; state: "planned" | "done" | "rest" | "event" };
  exertion: { soFar: number | null; low: number | null; high: number | null; landsAt: number | null } | null;
}

const WIDGET_METRICS: { key: GlanceKey; label: string; format: (v: number) => string }[] = [
  { key: "hrv", label: "HRV", format: (v) => `${Math.round(v)} ms` },
  { key: "restingHeartRate", label: "Resting HR", format: (v) => `${Math.round(v)} bpm` },
  { key: "sleepHours", label: "Sleep", format: formatHours },
];


const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function widgetSnapshot(state: TrainingState, exertion: ExertionToday | null, now = new Date()): WidgetSnapshot {
  const { today, recovery } = state;
  const glance = recovery?.glance;
  const score = recovery?.score ?? null;

  const metrics = WIDGET_METRICS.flatMap(({ key, label, format }) => {
    const m = glance?.metrics.find((x) => x.key === key);
    return m && m.value !== null ? [{ key, label, value: format(m.value), concern: m.concern }] : [];
  });

  return {
    v: WIDGET_SNAPSHOT_VERSION,
    at: now.toISOString(),
    day: today,
    recovery: recovery
      ? {
          score: score?.score ?? null,
          word: score ? capital(recoveryWord(score.score)) : null,
          reason: score ? (score.reasons[0] ?? "A normal day for you") : recovery.today ? `Building your baseline: ${recovery.baselineDays} of ${MINIMUM_BASELINE_DAYS} nights` : "Waiting for last night",
          week: glance?.scores.map((s) => s.score) ?? [],
        }
      : null,
    metrics,
    sleepScore: glance?.sleepScore?.score ?? null,
    signal: glance?.signals[0]?.reason ?? null,
    today: todayLine(state),
    exertion:
      exertion && (exertion.soFar !== null || exertion.target)
        ? {
            soFar: exertion.soFar === null ? null : oneDecimal(exertion.soFar),
            low: exertion.target ? oneDecimal(exertion.target.low) : null,
            high: exertion.target ? oneDecimal(exertion.target.high) : null,
            landsAt: exertion.planned ? oneDecimal(exertion.planned.landsAt) : null,
          }
        : null,
  };
}

function todayLine(state: TrainingState): WidgetSnapshot["today"] {
  const { today, athlete, todayPlan, todayStored } = state;
  const ridden = state.rides.filter((r) => localDate(r.startedAt, athlete.timezone) === today);
  if (ridden.length) {
    const minutes = Math.round(ridden.reduce((s, r) => s + r.durationSeconds, 0) / 60);
    return { title: "Ride done", detail: `${minutes} min today`, state: "done" };
  }
  if (todayPlan?.role === "event" && todayPlan.goal) return { title: todayPlan.goal.name, detail: "Race day", state: "event" };
  const session = todayStored?.chosen ? todayStored.chosen.session : (todayPlan?.session ?? null);
  if (!session) return { title: "Rest day", detail: null, state: "rest" };
  return {
    title: session.workout.name,
    detail: `${Math.round(session.duration / 60)} min · ${ZONE_LABELS[session.zone] ?? session.zone}`,
    state: "planned",
  };
}
