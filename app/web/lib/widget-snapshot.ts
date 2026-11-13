// What the iPhone's home and lock screen widgets show: last night's recovery and today's ride,
// already worded and formatted, so the widget (Swift, src-tauri/ios/widgets) only lays it out.
// Every number is the engine's; this picks and words them. Written by the app after each Health
// read and sync (src/phone/widget.ts).

import { formatHours } from "@/lib/engine/hours";
import { localDate } from "./engine/activity";
import { markDays } from "./engine/compliance";
import { type Session, ZONE_LABELS } from "./engine/library";
import { PHASE_LABELS, weekStart } from "./engine/plan";
import { addDays } from "./engine/pmc";
import { MINIMUM_BASELINE_DAYS, recoveryWord } from "./engine/recovery";
import type { ExertionToday, GlanceKey } from "./engine/recovery-glance";
import { zoneStep } from "./engine/ride-calendar";
import { complianceDays, plannedOn, type TrainingState } from "./training";
import { signed } from "./format";
import { weightIn, weightUnit, type UnitSystem } from "./units";

export const WIDGET_SNAPSHOT_VERSION = 1;

/** A day's ride for the widgets. Fields after `state` were added later and are optional to older widgets. */
export interface WidgetDay {
  title: string;
  detail: string | null;
  state: "planned" | "done" | "rest" | "event";
  /** Planned or ridden training stress, rounded. */
  stress?: number | null;
  /** The workout's zone as the app's 1 (recovery) to 7 (anaerobic) color step; null for rest, events and free rides. */
  step?: number | null;
}

/** One day of this week for the widgets' week row, Monday first. */
export interface WidgetWeekDay {
  /** "M", "T", … */
  label: string;
  /** done: ridden (to plan or not); partial: ridden short of plan; missed; rest: nothing planned; planned: still to come. */
  state: "done" | "partial" | "missed" | "rest" | "planned";
  today: boolean;
}

export interface WidgetWeek {
  /** "Build week", "Recovery week"; null outside a plan. */
  label: string | null;
  days: WidgetWeekDay[];
  /** Planned days ridden, and planned days in the week. */
  rides: { done: number; planned: number };
  /** Time ridden and time planned this week, worded, and their share (0 to 1, capped). */
  time: { done: string; planned: string; share: number };
}

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
  today: WidgetDay;
  exertion: { soFar: number | null; low: number | null; high: number | null; landsAt: number | null } | null;
  /** Whether the rider tracks sleep and recovery; when not, the widgets lead with the ride. Missing means true. */
  recoveryTracked?: boolean;
  tomorrow?: WidgetDay | null;
  week?: WidgetWeek | null;
  /** The numbers the Fields widget can show, each one the rider picks with Edit Widget (added later). */
  fields?: WidgetField[];
}

/** The Fields widget's choices; Swift's FieldChoice uses the same keys. */
export const WIDGET_FIELD_KEYS = ["recovery", "hrv", "restingHr", "sleep", "form", "fitness", "fatigue", "ftp", "today", "week", "rides", "weight"] as const;
export type WidgetFieldKey = (typeof WIDGET_FIELD_KEYS)[number];

/** One number for the Fields widget, worded. Left out when there's nothing to show; the widget shows "–". */
export interface WidgetField {
  key: WidgetFieldKey;
  label: string;
  value: string;
  unit: string;
}

const WIDGET_METRICS: { key: GlanceKey; label: string; format: (v: number) => string }[] = [
  { key: "hrv", label: "HRV", format: (v) => `${Math.round(v)} ms` },
  { key: "restingHeartRate", label: "Resting HR", format: (v) => `${Math.round(v)} bpm` },
  { key: "sleepHours", label: "Sleep", format: formatHours },
];


const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function widgetSnapshot(state: TrainingState, exertion: ExertionToday | null, now = new Date(), recoveryTracked = true, units: UnitSystem = "metric"): WidgetSnapshot {
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
    // Sleep debt stays off the widget (a weekly total read as alarming; Today shows tonight's aim instead).
    signal: glance?.signals.find((s) => s.id !== "sleepDebt")?.reason ?? null,
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
    recoveryTracked,
    tomorrow: tomorrowLine(state),
    week: weekLine(state),
    fields: widgetFields(state, units),
  };
}

/** The Fields widget's numbers, from the same engine values Today shows. */
function widgetFields(state: TrainingState, units: UnitSystem): WidgetField[] {
  const out: WidgetField[] = [];
  const add = (key: WidgetFieldKey, label: string, value: string | null | undefined, unit = "") => {
    if (value !== null && value !== undefined && value !== "") out.push({ key, label, value, unit });
  };
  // Last night as Today's recovery tiles show it, or as read when the glance has no entry for it.
  const night = state.recovery?.today;
  const glance = (key: GlanceKey & keyof NonNullable<typeof night>) => state.recovery?.glance?.metrics.find((m) => m.key === key)?.value ?? night?.[key] ?? null;
  const round = (v: number | null) => (v === null ? null : String(Math.round(v)));
  const score = state.recovery?.score?.score;
  add("recovery", "Recovery", score === undefined ? null : String(Math.round(score)));
  add("hrv", "HRV", round(glance("hrv")), "ms");
  add("restingHr", "Resting HR", round(glance("restingHeartRate")), "bpm");
  const sleep = glance("sleepHours");
  add("sleep", "Sleep", sleep === null ? null : formatHours(sleep));
  const now = state.series.at(-1);
  if (now) {
    add("form", "Form", signed(Math.round(now.form)));
    add("fitness", "Fitness", String(Math.round(now.fitness)));
    add("fatigue", "Fatigue", String(Math.round(now.fatigue)));
  }
  add("ftp", "FTP", state.athlete.ftp ? String(Math.round(state.athlete.ftp)) : null, "W");
  add("today", "Today", todayLine(state).title);
  const week = weekLine(state);
  if (week) {
    add("week", "This week", week.time.done, `of ${week.time.planned}`);
    add("rides", "Rides", `${week.rides.done} of ${week.rides.planned}`);
  }
  if (state.athlete.weightKg) add("weight", "Weight", weightIn(state.athlete.weightKg, units).toFixed(1), weightUnit(units));
  return out;
}

const sessionDay = (session: Session): WidgetDay => ({
  title: session.workout.name,
  detail: `${Math.round(session.duration / 60)} min · ${ZONE_LABELS[session.zone] ?? session.zone}`,
  state: "planned",
  stress: Math.round(session.stress),
  step: zoneStep(session.zone),
});

function tomorrowLine(state: TrainingState): WidgetDay {
  const day = addDays(state.today, 1);
  const planDay = state.plan.weeks.flatMap((w) => w.days).find((d) => d.date === day);
  if (planDay?.role === "event" && planDay.goal) return { title: planDay.goal.name, detail: "Race day", state: "event", stress: null, step: null };
  const planned = plannedOn(state, day);
  return planned?.session ? sessionDay(planned.session) : { title: "Rest day", detail: null, state: "rest", stress: null, step: null };
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** This week, Monday to Sunday: each day planned against ridden, and rides and time so far against the plan. */
function weekLine(state: TrainingState): WidgetWeek | null {
  const { today } = state;
  const monday = weekStart(today);
  const days = complianceDays(state, monday, addDays(monday, 6));
  const marks = markDays(complianceDays(state, addDays(monday, -1), addDays(monday, 7)), today);
  const planWeek = state.plan.weeks.find((w) => w.start === monday);
  const label = planWeek && !planWeek.beforePlan ? (planWeek.recoveryWeek ? "Recovery week" : `${PHASE_LABELS[planWeek.phase]} week`) : null;

  const out = days.map((d, i): WidgetWeekDay => {
    const planned = Boolean(d.planned && d.planned.stress > 0);
    const mark = marks.get(d.date);
    let s: WidgetWeekDay["state"];
    if (d.rides.length) s = mark?.mark === "partial" ? "partial" : "done";
    else if (mark?.mark === "missed") s = "missed";
    else if (mark?.mark === "moved") s = "done";
    else s = planned && d.date >= today ? "planned" : "rest";
    return { label: WEEKDAY_LETTERS[i], state: s, today: d.date === today };
  });

  const plannedDays = days.filter((d) => d.planned && d.planned.stress > 0);
  if (!plannedDays.length && !days.some((d) => d.rides.length)) return null;
  const ridden = plannedDays.filter((d) => {
    const m = marks.get(d.date)?.mark;
    return m === "done" || m === "partial" || (m === "moved" && marks.get(d.date)?.movedTo !== undefined);
  }).length;
  const plannedSeconds = plannedDays.reduce((t, d) => t + (d.planned?.duration ?? 0), 0);
  const doneSeconds = days.filter((d) => d.date <= today && !d.beforePlan).reduce((t, d) => t + d.rides.reduce((u, r) => u + r.durationSeconds, 0), 0);
  return {
    label,
    days: out,
    rides: { done: ridden, planned: plannedDays.length },
    time: {
      done: formatHours(doneSeconds / 3600),
      planned: formatHours(plannedSeconds / 3600),
      share: plannedSeconds > 0 ? Math.min(1, Math.round((doneSeconds / plannedSeconds) * 100) / 100) : 0,
    },
  };
}

function todayLine(state: TrainingState): WidgetSnapshot["today"] {
  const { today, athlete, todayPlan, todayStored } = state;
  const ridden = state.rides.filter((r) => localDate(r.startedAt, athlete.timezone) === today);
  if (ridden.length) {
    const minutes = Math.round(ridden.reduce((s, r) => s + r.durationSeconds, 0) / 60);
    const stress = ridden.some((r) => r.trainingStress !== null) ? Math.round(ridden.reduce((t, r) => t + (r.trainingStress ?? 0), 0)) : null;
    return { title: "Ride done", detail: stress !== null ? `${minutes} min · ${stress} TSS` : `${minutes} min today`, state: "done", stress, step: null };
  }
  if (todayPlan?.role === "event" && todayPlan.goal) return { title: todayPlan.goal.name, detail: "Race day", state: "event", stress: null, step: null };
  const session = todayStored?.chosen ? todayStored.chosen.session : (todayPlan?.session ?? null);
  if (!session) return { title: "Rest day", detail: null, state: "rest", stress: null, step: null };
  return sessionDay(session);
}
