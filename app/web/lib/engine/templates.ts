// Workout structures: for each zone, the classic N x M at one target and variations on it (surges,
// over-unders, ladders, 30/30s, attacks, race starts...). A level sets each structure's durations,
// targets and how much work its main set holds; its named targets can also be set directly, which
// is how the plan and the coach pick a specific workout. Targets are fractions of FTP.

import { steady, ramp, sprint, type Segment } from "./workout";
import type { Zone } from "./library";

/** What a structure trains, so the plan can favor ones that suit an event. */
export const FOCUSES = ["sustained", "progressive", "surges", "overUnder", "hardStart", "repeatability", "sprint", "raceSim"] as const;
export type Focus = (typeof FOCUSES)[number];

export const FOCUS_LABELS: Record<Focus, string> = {
  sustained: "Sustained power",
  progressive: "Building or stepped power",
  surges: "Surges on a steady effort",
  overUnder: "Over-unders around a target",
  hardStart: "Hard starts, then settling in",
  repeatability: "Short efforts, many times",
  sprint: "Sprints and spin-ups",
  raceSim: "Race-like efforts",
};

/** Named numbers a structure is built from: targets as fractions of FTP, durations in seconds, or counts. */
export type Params = Record<string, number>;

export interface Param {
  key: string;
  label: string;
  unit: "ftp" | "seconds" | "count";
  min: number;
  max: number;
}

export type TemplateZone = Exclude<Zone, "recovery">;

export interface Template {
  id: string;
  zone: TemplateZone;
  name: string;
  description: string;
  focus: Focus[];
  params: Param[];
  /** Every param at a level. */
  defaults: (level: number) => Params;
  /** The main set in `seconds` or less, and the workout's name; null when it doesn't fit. */
  main: (p: Params, level: number, seconds: number) => { segments: Segment[]; title: string } | null;
  /** Target for time the main set leaves over (endurance riding by default). */
  pad?: (p: Params) => number;
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
/** Short intervals to 5 seconds, longer ones to 30. */
const sec = (seconds: number) => roundTo(seconds, seconds < 120 ? 5 : 30);
const t2 = (fraction: number) => Math.round(fraction * 100) / 100;
const pct = (fraction: number) => Math.round(fraction * 100);
const total = (segments: Segment[]) => segments.reduce((s, x) => s + x.duration, 0);

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}:${String(s).padStart(2, "0")}` : `${m} min`;
}

/**
 * `block` up to `want` times with `between` after each but the last, as many as fit in `seconds`.
 * Null when fewer than `min` fit.
 */
function repeat(block: Segment[], between: Segment[], want: number, seconds: number, min = 2) {
  const b = total(block);
  const r = total(between);
  if (b <= 0) return null;
  const fit = Math.floor((seconds + r) / (b + r));
  const reps = Math.min(fit, Math.max(min, Math.round(want)));
  if (reps < min) return null;
  const segments: Segment[] = [];
  for (let i = 0; i < reps; i++) {
    segments.push(...block);
    if (i < reps - 1) segments.push(...between);
  }
  return { segments, reps };
}

/** `seconds` at `target` with a `burst` at `peak` closing every `every` seconds. */
function withBursts(seconds: number, target: number, every: number, burst: number, peak: number): Segment[] {
  const out: Segment[] = [];
  const cycles = Math.max(1, Math.floor(seconds / every));
  for (let i = 0; i < cycles; i++) out.push(steady(every - burst, target), steady(burst, peak));
  const left = seconds - cycles * every;
  if (left > 0) out.push(steady(left, target));
  return out;
}

/** Seconds of work the main set holds at a level, per zone (the classic recipes' totals). */
const WORK_TOTAL: Record<Exclude<TemplateZone, "endurance">, (level: number) => number> = {
  tempo: (l) => (20 + 7 * l) * 60,
  sweetSpot: (l) => (16 + 6 * l) * 60,
  threshold: (l) => (12 + 4 * l) * 60,
  vo2max: (l) => (8 + 1.6 * l) * 60,
  anaerobic: (l) => (3 + 0.6 * l) * 60,
};

const p = (key: string, label: string, unit: Param["unit"], min: number, max: number): Param => ({ key, label, unit, min, max });
const WORK = (label = "Work target") => p("work", label, "ftp", 0.5, 2.5);
const ON = (label = "Work interval") => p("on", label, "seconds", 5, 3600);
const OFF = p("off", "Recovery between", "seconds", 10, 900);
const REST = p("rest", "Recovery target", "ftp", 0.3, 0.75);

interface ClassicRecipe {
  work: (level: number) => number;
  rest: (work: number) => number;
  target: (level: number) => number;
  restTarget: number;
}

/** N x M at one target: each level adds time in zone (longer intervals, more total work). */
function classic(zone: Exclude<TemplateZone, "endurance">, label: string, recipe: ClassicRecipe, focus: Focus[], description: string): Template {
  return {
    id: `${zone}-intervals`,
    zone,
    name: `${label} intervals`,
    description,
    focus,
    params: [ON(), WORK(), OFF, REST],
    defaults: (l) => {
      const on = sec(recipe.work(l));
      return { on, work: t2(recipe.target(l)), off: roundTo(recipe.rest(on), 30), rest: recipe.restTarget };
    },
    main: (x, l, s) => {
      const set = repeat([steady(x.on, x.work)], [steady(x.off, x.rest)], WORK_TOTAL[zone](l) / x.on, s);
      return set && { segments: set.segments, title: `${label} ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}%` };
    },
  };
}

const TEMPO: Template[] = [
  classic(
    "tempo",
    "Tempo",
    { work: (l) => (10 + 2.5 * l) * 60, rest: () => 300, target: (l) => 0.8 + 0.006 * l, restTarget: 0.55 },
    ["sustained"],
    "Long steady blocks at tempo: aerobic strength and muscular endurance.",
  ),
  {
    id: "tempo-bursts",
    zone: "tempo",
    name: "Tempo with bursts",
    description: "Tempo blocks with a short burst every couple of minutes, like riding a group that keeps attacking the rises.",
    focus: ["surges"],
    params: [ON("Block"), WORK("Tempo target"), p("peak", "Burst target", "ftp", 1, 2), p("burst", "Burst", "seconds", 5, 30), p("every", "Burst every", "seconds", 60, 600), OFF, REST],
    defaults: (l) => ({ on: roundTo((8 + 2 * l) * 60, 120), work: t2(0.8 + 0.006 * l), peak: 1.2, burst: 10, every: 120, off: 300, rest: 0.55 }),
    main: (x, l, s) => {
      const set = repeat(withBursts(x.on, x.work, x.every, x.burst, x.peak), [steady(x.off, x.rest)], WORK_TOTAL.tempo(l) / x.on, s);
      return set && { segments: set.segments, title: `Tempo bursts ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}% (${x.burst} s @ ${pct(x.peak)}%)` };
    },
  },
  {
    id: "tempo-build",
    zone: "tempo",
    name: "Tempo build",
    description: "Each block steps up in three parts, finishing just under sweet spot: pacing that gets harder as you tire.",
    focus: ["progressive"],
    params: [ON("Block"), WORK("Middle step target"), p("step", "Step size", "ftp", 0.01, 0.1), OFF, REST],
    defaults: (l) => ({ on: roundTo((9 + 2 * l) * 60, 180), work: t2(0.8 + 0.006 * l), step: 0.03, off: 300, rest: 0.55 }),
    main: (x, l, s) => {
      const third = roundTo(x.on / 3, 30);
      const block = [steady(third, x.work - x.step), steady(third, x.work), steady(third, x.work + x.step)];
      const set = repeat(block, [steady(x.off, x.rest)], WORK_TOTAL.tempo(l) / (3 * third), s);
      return set && { segments: set.segments, title: `Tempo build ${set.reps} x ${formatInterval(3 * third)} (${pct(x.work - x.step)}-${pct(x.work + x.step)}%)` };
    },
  },
];

const SWEET_SPOT: Template[] = [
  classic(
    "sweetSpot",
    "Sweet spot",
    { work: (l) => (8 + 2 * l) * 60, rest: () => 240, target: (l) => 0.88 + 0.005 * l, restTarget: 0.5 },
    ["sustained"],
    "Steady intervals just under threshold: the most fitness for the time.",
  ),
  {
    id: "sweetSpot-long",
    zone: "sweetSpot",
    name: "Long sweet spot",
    description: "One or two long unbroken blocks: holding power and focus when it gets uncomfortable.",
    focus: ["sustained"],
    params: [ON("Block"), WORK(), OFF, REST],
    defaults: (l) => ({ on: roundTo((15 + 4 * l) * 60, 300), work: t2(0.88 + 0.003 * l), off: 300, rest: 0.5 }),
    main: (x, l, s) => {
      const set = repeat([steady(x.on, x.work)], [steady(x.off, x.rest)], Math.max(1, WORK_TOTAL.sweetSpot(l) / x.on), s, 1);
      return set && { segments: set.segments, title: `Long sweet spot ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}%` };
    },
  },
  {
    id: "sweetSpot-surges",
    zone: "sweetSpot",
    name: "Sweet spot with surges",
    description: "Sweet spot blocks with a hard surge every two minutes, then straight back to pace: recovering while still working.",
    focus: ["surges"],
    params: [ON("Block"), WORK("Sweet spot target"), p("peak", "Surge target", "ftp", 1, 2), p("burst", "Surge", "seconds", 5, 30), p("every", "Surge every", "seconds", 60, 600), OFF, REST],
    defaults: (l) => ({ on: roundTo((8 + 2 * l) * 60, 120), work: t2(0.88 + 0.004 * l), peak: t2(1.25 + 0.01 * l), burst: 15, every: 120, off: 240, rest: 0.5 }),
    main: (x, l, s) => {
      const set = repeat(withBursts(x.on, x.work, x.every, x.burst, x.peak), [steady(x.off, x.rest)], WORK_TOTAL.sweetSpot(l) / x.on, s);
      return set && { segments: set.segments, title: `Sweet spot surges ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}% (${x.burst} s @ ${pct(x.peak)}%)` };
    },
  },
  {
    id: "sweetSpot-overunder",
    zone: "sweetSpot",
    name: "Sweet spot over-unders",
    description: "Alternating a little under and a little over sweet spot: an easier way into over-unders.",
    focus: ["overUnder"],
    params: [p("under", "Under target", "ftp", 0.7, 1), p("over", "Over target", "ftp", 0.85, 1.1), p("underOn", "Under", "seconds", 30, 600), p("overOn", "Over", "seconds", 15, 300), p("cycles", "Cycles per block", "count", 2, 12), OFF, REST],
    defaults: (l) => ({ under: 0.85, over: t2(0.95 + 0.003 * l), underOn: 120, overOn: 60, cycles: 3 + Math.floor(l / 2), off: 240, rest: 0.5 }),
    main: (x, l, s) => {
      const block: Segment[] = [];
      for (let i = 0; i < x.cycles; i++) block.push(steady(x.underOn, x.under), steady(x.overOn, x.over));
      const set = repeat(block, [steady(x.off, x.rest)], WORK_TOTAL.sweetSpot(l) / total(block), s);
      return set && { segments: set.segments, title: `Sweet spot over-unders ${set.reps} x ${formatInterval(total(block))} (${pct(x.under)}/${pct(x.over)}%)` };
    },
  },
  {
    id: "sweetSpot-ladder",
    zone: "sweetSpot",
    name: "Sweet spot ladder",
    description: "Four steps climbing from the bottom to the top of sweet spot in each block.",
    focus: ["progressive"],
    params: [p("step", "Step", "seconds", 60, 900), p("low", "First step", "ftp", 0.75, 1), p("high", "Last step", "ftp", 0.8, 1.05), OFF, REST],
    defaults: (l) => ({ step: roundTo((2 + 0.5 * l) * 60, 30), low: 0.85, high: t2(0.92 + 0.002 * l), off: 240, rest: 0.5 }),
    main: (x, l, s) => {
      const block = [0, 1, 2, 3].map((i) => steady(x.step, t2(x.low + ((x.high - x.low) * i) / 3)));
      const set = repeat(block, [steady(x.off, x.rest)], WORK_TOTAL.sweetSpot(l) / total(block), s);
      return set && { segments: set.segments, title: `Sweet spot ladder ${set.reps} x 4 x ${formatInterval(x.step)} (${pct(x.low)}-${pct(x.high)}%)` };
    },
  },
];

const thresholdRest = (on: number) => roundTo(Math.min(Math.max(on / 2, 180), 300), 30);

const THRESHOLD: Template[] = [
  classic(
    "threshold",
    "Threshold",
    { work: (l) => (5 + 1.5 * l) * 60, rest: (w) => Math.min(Math.max(w / 2, 180), 300), target: (l) => 0.95 + 0.005 * l, restTarget: 0.5 },
    ["sustained"],
    "Steady intervals at FTP: raises the power you can hold for an hour.",
  ),
  {
    id: "threshold-overunder",
    zone: "threshold",
    name: "Over-unders",
    description: "Alternating just under and over FTP: clearing lactate while still working, for races that never settle.",
    focus: ["overUnder"],
    params: [p("under", "Under target", "ftp", 0.8, 1), p("over", "Over target", "ftp", 0.98, 1.3), p("underOn", "Under", "seconds", 30, 600), p("overOn", "Over", "seconds", 15, 300), p("cycles", "Cycles per block", "count", 2, 10), OFF, REST],
    defaults: (l) => ({ under: 0.95, over: t2(1.05 + 0.004 * l), underOn: 120, overOn: 60, cycles: 2 + Math.floor(l / 3), off: 300, rest: 0.5 }),
    main: (x, l, s) => {
      const block: Segment[] = [];
      for (let i = 0; i < x.cycles; i++) block.push(steady(x.underOn, x.under), steady(x.overOn, x.over));
      const set = repeat(block, [steady(x.off, x.rest)], WORK_TOTAL.threshold(l) / total(block), s);
      return set && { segments: set.segments, title: `Over-unders ${set.reps} x ${formatInterval(total(block))} (${pct(x.under)}/${pct(x.over)}%)` };
    },
  },
  {
    id: "threshold-hardstart",
    zone: "threshold",
    name: "Threshold with hard starts",
    description: "Each interval opens with a hard effort, then settles at threshold: like bridging to a group and holding the wheel.",
    focus: ["hardStart"],
    params: [ON(), WORK("Settle target"), p("peak", "Start target", "ftp", 1.05, 2), p("start", "Hard start", "seconds", 10, 120), OFF, REST],
    defaults: (l) => {
      const on = sec((5 + 1.5 * l) * 60);
      return { on, work: t2(0.95 + 0.005 * l), peak: 1.3, start: 30, off: thresholdRest(on), rest: 0.5 };
    },
    main: (x, l, s) => {
      const set = repeat([steady(x.start, x.peak), steady(Math.max(x.on - x.start, 30), x.work)], [steady(x.off, x.rest)], WORK_TOTAL.threshold(l) / x.on, s);
      return set && { segments: set.segments, title: `Threshold hard starts ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}% (${x.start} s @ ${pct(x.peak)}%)` };
    },
  },
  {
    id: "threshold-ramps",
    zone: "threshold",
    name: "Threshold ramps",
    description: "Each interval climbs steadily from under to over FTP: pacing a climb that kicks up at the top.",
    focus: ["progressive"],
    params: [ON(), p("from", "Start target", "ftp", 0.8, 1), p("to", "Finish target", "ftp", 0.95, 1.3), OFF, REST],
    defaults: (l) => {
      const on = sec((6 + 1.5 * l) * 60);
      return { on, from: 0.92, to: t2(1.02 + 0.005 * l), off: thresholdRest(on), rest: 0.5 };
    },
    main: (x, l, s) => {
      const set = repeat([ramp(x.on, x.from, x.to)], [steady(x.off, x.rest)], WORK_TOTAL.threshold(l) / x.on, s);
      return set && { segments: set.segments, title: `Threshold ramps ${set.reps} x ${formatInterval(x.on)} (${pct(x.from)}→${pct(x.to)}%)` };
    },
  },
  {
    id: "threshold-surges",
    zone: "threshold",
    name: "Threshold with surges",
    description: "Just under FTP with a surge every few minutes: holding a hard pace when the race keeps kicking.",
    focus: ["surges"],
    params: [ON("Block"), WORK("Base target"), p("peak", "Surge target", "ftp", 1.05, 2), p("burst", "Surge", "seconds", 5, 60), p("every", "Surge every", "seconds", 60, 600), OFF, REST],
    defaults: (l) => {
      const on = roundTo((6 + 1.5 * l) * 60, 180);
      return { on, work: t2(0.93 + 0.004 * l), peak: 1.25, burst: 15, every: 180, off: thresholdRest(on), rest: 0.5 };
    },
    main: (x, l, s) => {
      const set = repeat(withBursts(x.on, x.work, x.every, x.burst, x.peak), [steady(x.off, x.rest)], WORK_TOTAL.threshold(l) / x.on, s);
      return set && { segments: set.segments, title: `Threshold surges ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}% (${x.burst} s @ ${pct(x.peak)}%)` };
    },
  },
];

/** Sets of short on/off efforts (30/30s, 40/20s, 30/15s). */
function onOff(id: string, name: string, description: string, defaults: (l: number) => Params): Template {
  return {
    id,
    zone: "vo2max",
    name,
    description,
    focus: ["repeatability"],
    params: [ON("On"), WORK("On target"), p("off", "Off", "seconds", 5, 120), REST, p("count", "Efforts per set", "count", 3, 20), p("setRest", "Between sets", "seconds", 60, 900)],
    defaults,
    main: (x, l, s) => {
      const block: Segment[] = [];
      for (let i = 0; i < x.count; i++) {
        block.push(steady(x.on, x.work));
        if (i < x.count - 1) block.push(steady(x.off, x.rest));
      }
      const set = repeat(block, [steady(x.setRest, x.rest)], WORK_TOTAL.vo2max(l) / (x.count * x.on), s);
      return set && { segments: set.segments, title: `${name} ${set.reps} sets of ${x.count} x ${x.on}/${x.off} s @ ${pct(x.work)}%` };
    },
  };
}

const VO2MAX: Template[] = [
  classic(
    "vo2max",
    "VO2 max",
    { work: (l) => (2 + 0.25 * l) * 60, rest: (w) => w, target: (l) => 1.2 - 0.005 * l, restTarget: 0.45 },
    ["sustained"],
    "Hard intervals of a few minutes: raises your aerobic ceiling.",
  ),
  onOff("vo2max-3030", "30/30s", "Thirty seconds on, thirty easy, in sets: lots of time near VO2 max with less suffering per effort.", (l) => ({
    on: 30,
    work: t2(1.2 + 0.005 * l),
    off: 30,
    rest: 0.5,
    count: 6 + Math.floor(l / 2),
    setRest: 300,
  })),
  onOff("vo2max-4020", "40/20s", "Forty seconds on, twenty easy: short recoveries keep the heart rate high.", (l) => ({
    on: 40,
    work: t2(1.13 + 0.004 * l),
    off: 20,
    rest: 0.5,
    count: 5 + Math.floor(l / 2),
    setRest: 300,
  })),
  onOff("vo2max-3015", "30/15s", "Thirty seconds on, fifteen easy (Rønnestad intervals): a proven way to build VO2 max.", (l) => ({
    on: 30,
    work: t2(1.15 + 0.005 * l),
    off: 15,
    rest: 0.5,
    count: Math.min(13, 8 + Math.floor(l / 2)),
    setRest: 180,
  })),
  {
    id: "vo2max-pyramid",
    zone: "vo2max",
    name: "VO2 max pyramid",
    description: "Efforts that grow to a long one in the middle and shrink again, each followed by equal recovery.",
    focus: ["progressive"],
    params: [p("top", "Longest effort", "seconds", 60, 360), WORK(), REST, p("setRest", "Between pyramids", "seconds", 60, 900)],
    defaults: (l) => ({ top: 180, work: t2(1.12 + 0.004 * l), rest: 0.45, setRest: 300 }),
    main: (x, l, s) => {
      const steps = [1, 2, 3, 2, 1].map((n) => sec((x.top * n) / 3));
      const block: Segment[] = [];
      steps.forEach((d, i) => {
        block.push(steady(d, x.work));
        if (i < steps.length - 1) block.push(steady(d, x.rest));
      });
      const work = steps.reduce((a, b) => a + b, 0);
      const set = repeat(block, [steady(x.setRest, x.rest)], Math.max(1, WORK_TOTAL.vo2max(l) / work), s, 1);
      const label = steps.map((d) => (d % 60 ? `${d}s` : `${d / 60}`)).join("-");
      return set && { segments: set.segments, title: `VO2 max pyramid ${set.reps} x ${label} min @ ${pct(x.work)}%` };
    },
  },
  {
    id: "vo2max-hardstart",
    zone: "vo2max",
    name: "VO2 max with hard starts",
    description: "A fast start to each interval gets you to VO2 max sooner, then you hold just over it.",
    focus: ["hardStart"],
    params: [ON(), WORK("Hold target"), p("peak", "Start target", "ftp", 1.1, 2.5), p("start", "Hard start", "seconds", 10, 60), OFF, REST],
    defaults: (l) => {
      const on = roundTo((2.5 + 0.25 * l) * 60, 30);
      return { on, work: t2(1.08 + 0.003 * l), peak: 1.4, start: 30, off: on, rest: 0.45 };
    },
    main: (x, l, s) => {
      const set = repeat([steady(x.start, x.peak), steady(Math.max(x.on - x.start, 30), x.work)], [steady(x.off, x.rest)], WORK_TOTAL.vo2max(l) / x.on, s);
      return set && { segments: set.segments, title: `VO2 max hard starts ${set.reps} x ${formatInterval(x.on)} @ ${pct(x.work)}% (${x.start} s @ ${pct(x.peak)}%)` };
    },
  },
  {
    id: "vo2max-descending",
    zone: "vo2max",
    name: "VO2 max descending",
    description: "4, 3, 2 and 1 minute efforts, each harder than the last: the shorter they get, the harder you go.",
    focus: ["progressive"],
    params: [WORK("First effort target"), p("climb", "Added per step", "ftp", 0, 0.15), p("between", "Recovery between", "seconds", 30, 300), REST, p("setRest", "Between sets", "seconds", 60, 900)],
    defaults: (l) => ({ work: t2(1.06 + 0.004 * l), climb: 0.04, between: 120, rest: 0.45, setRest: 300 }),
    main: (x, l, s) => {
      const block: Segment[] = [];
      [240, 180, 120, 60].forEach((d, i) => {
        block.push(steady(d, t2(x.work + x.climb * i)));
        if (i < 3) block.push(steady(x.between, x.rest));
      });
      const set = repeat(block, [steady(x.setRest, x.rest)], Math.max(1, WORK_TOTAL.vo2max(l) / 600), s, 1);
      return set && { segments: set.segments, title: `VO2 max descending ${set.reps} x 4-3-2-1 min (${pct(x.work)}-${pct(x.work + 3 * x.climb)}%)` };
    },
  },
];

const ANAEROBIC: Template[] = [
  classic(
    "anaerobic",
    "Anaerobic",
    { work: (l) => 20 + 5 * l, rest: (w) => Math.max(w * 3, 120), target: (l) => 1.5 - 0.01 * l, restTarget: 0.45 },
    ["repeatability"],
    "Short, very hard efforts with long recoveries: for cyclocross and crit surges.",
  ),
  {
    id: "anaerobic-attacks",
    zone: "anaerobic",
    name: "Attacks",
    description: "Clusters of hard attacks, then a block at sweet spot to settle in: going with moves and holding the pace after.",
    focus: ["surges", "raceSim"],
    params: [p("burst", "Attack", "seconds", 5, 60), p("peak", "Attack target", "ftp", 1.2, 2.5), p("gap", "Between attacks", "seconds", 15, 180), p("floor", "Between attacks target", "ftp", 0.4, 0.9), p("count", "Attacks per set", "count", 2, 8), p("settle", "Settle block", "seconds", 60, 900), WORK("Settle target"), OFF, REST],
    defaults: (l) => ({
      burst: roundTo(10 + 0.5 * l, 5),
      peak: t2(1.6 - 0.005 * l),
      gap: 45,
      floor: 0.6,
      count: 3 + (l >= 6 ? 1 : 0),
      settle: roundTo(240 + 20 * l, 30),
      work: t2(0.85 + 0.005 * l),
      off: 180,
      rest: 0.5,
    }),
    main: (x, l, s) => {
      const block: Segment[] = [];
      for (let i = 0; i < x.count; i++) block.push(steady(x.burst, x.peak), steady(x.gap, x.floor));
      block.push(steady(x.settle, x.work));
      const set = repeat(block, [steady(x.off, x.rest)], 2 + Math.floor(l / 3), s);
      return set && { segments: set.segments, title: `Attacks ${set.reps} sets of ${x.count} x ${x.burst} s @ ${pct(x.peak)}% + ${formatInterval(x.settle)} @ ${pct(x.work)}%` };
    },
  },
  {
    id: "anaerobic-microbursts",
    zone: "anaerobic",
    name: "Micro-bursts",
    description: "Fifteen seconds hard, fifteen easy, over and over: the rhythm of a crit or a technical cross lap.",
    focus: ["repeatability", "surges"],
    params: [ON("On"), WORK("On target"), p("off", "Off", "seconds", 5, 60), REST, p("count", "Efforts per set", "count", 4, 30), p("setRest", "Between sets", "seconds", 60, 900)],
    defaults: (l) => ({ on: 15, work: t2(1.4 + 0.005 * l), off: 15, rest: 0.5, count: 8 + Math.floor(l), setRest: 300 }),
    main: (x, l, s) => {
      const count = Math.round(x.count);
      const block: Segment[] = [];
      for (let i = 0; i < count; i++) {
        block.push(steady(x.on, x.work));
        if (i < count - 1) block.push(steady(x.off, x.rest));
      }
      const set = repeat(block, [steady(x.setRest, x.rest)], 2 + Math.floor(l / 4), s);
      return set && { segments: set.segments, title: `Micro-bursts ${set.reps} sets of ${count} x ${x.on}/${x.off} s @ ${pct(x.work)}%` };
    },
  },
  {
    id: "anaerobic-sprints",
    zone: "anaerobic",
    name: "Sprints",
    description: "Short all-out sprints with full recovery. ERG lets go for each sprint, so you can go as hard as you like.",
    focus: ["sprint"],
    params: [ON("Sprint"), WORK("Sprint target"), OFF, REST],
    defaults: (l) => ({ on: roundTo(8 + 0.5 * l, 1), work: 2, off: 240, rest: 0.5 }),
    main: (x, l, s) => {
      const set = repeat([sprint(x.on, x.work)], [steady(x.off, x.rest)], 4 + Math.floor(l / 2), s, 3);
      return set && { segments: set.segments, title: `Sprints ${set.reps} x ${x.on} s @ ${pct(x.work)}%` };
    },
  },
  {
    id: "anaerobic-racestarts",
    zone: "anaerobic",
    name: "Race starts",
    description: "A full-gas start, a hard minute to hold position, then settling just under threshold while the surges keep coming: a cyclocross or crit opening.",
    focus: ["hardStart", "raceSim"],
    params: [p("start", "Start", "seconds", 10, 60), p("peak", "Start target", "ftp", 1.2, 2.5), p("hold", "Hold target", "ftp", 1, 1.5), p("settle", "Settle", "seconds", 60, 900), WORK("Settle target"), p("surge", "Surge target", "ftp", 1, 2), OFF, REST],
    defaults: (l) => ({ start: 20, peak: t2(1.7 - 0.005 * l), hold: 1.15, settle: roundTo((2 + 0.3 * l) * 60, 30), work: 0.92, surge: 1.3, off: 240, rest: 0.5 }),
    main: (x, l, s) => {
      const block = [sprint(x.start, x.peak), steady(40, x.hold), ...withBursts(x.settle, x.work, 60, 10, x.surge)];
      const set = repeat(block, [steady(x.off, x.rest)], 2 + Math.floor(l / 3), s);
      return set && { segments: set.segments, title: `Race starts ${set.reps} x ${x.start} s @ ${pct(x.peak)}% + ${formatInterval(x.settle)} @ ${pct(x.work)}%` };
    },
  },
];

const enduranceTarget = (l: number) => t2(0.6 + 0.012 * l);

const ENDURANCE: Template[] = [
  {
    id: "endurance-tempo",
    zone: "endurance",
    name: "Endurance with tempo",
    description: "Endurance riding with a tempo block every twenty minutes: a steady ride with some purpose.",
    focus: ["sustained"],
    params: [WORK("Endurance target"), p("tempo", "Tempo target", "ftp", 0.7, 0.9), p("on", "Tempo block", "seconds", 120, 1800), p("gap", "Endurance between", "seconds", 300, 3600)],
    defaults: (l) => ({ work: enduranceTarget(l), tempo: 0.78, on: roundTo((4 + l) * 60, 60), gap: 1200 }),
    main: (x, _l, s) => {
      const set = repeat([steady(x.gap, x.work), steady(x.on, x.tempo)], [], 99, s, 1);
      return set && { segments: set.segments, title: `Endurance with ${set.reps} x ${formatInterval(x.on)} tempo @ ${pct(x.tempo)}%` };
    },
    pad: (x) => x.work,
  },
  {
    id: "endurance-spinups",
    zone: "endurance",
    name: "Endurance with spin-ups",
    description: "Endurance riding with three short, fast spin-ups every ten minutes to keep the legs snappy.",
    focus: ["sprint"],
    params: [WORK("Endurance target"), p("peak", "Spin-up target", "ftp", 0.9, 2), p("burst", "Spin-up", "seconds", 5, 20)],
    defaults: (l) => ({ work: enduranceTarget(l), peak: 1.3, burst: 10 }),
    main: (x, _l, s) => {
      const block: Segment[] = [steady(600 - 3 * 30, x.work)];
      for (let i = 0; i < 3; i++) block.push(steady(x.burst, x.peak), steady(30 - x.burst, x.work));
      const set = repeat(block, [], 99, s, 1);
      return set && { segments: set.segments, title: `Endurance with spin-ups @ ${pct(x.work)}% (3 x ${x.burst} s @ ${pct(x.peak)}% every 10 min)` };
    },
    pad: (x) => x.work,
  },
];

export const TEMPLATES: Template[] = [...ENDURANCE, ...TEMPO, ...SWEET_SPOT, ...THRESHOLD, ...VO2MAX, ...ANAEROBIC];

export const templateById = (id: string | undefined | null): Template | null => (id ? (TEMPLATES.find((t) => t.id === id) ?? null) : null);

export const templatesFor = (zone: Zone): Template[] => TEMPLATES.filter((t) => t.zone === zone);

/** The classic N x M structure for an interval zone. */
export const classicTemplate = (zone: Exclude<TemplateZone, "endurance">): Template => templateById(`${zone}-intervals`)!;

/**
 * A structure for a key session: ones whose focus is in `prefer` (all of the zone's when none match
 * or none are preferred), rotated by `seed` so the same zone looks different from week to week.
 */
export function pickTemplate(zone: Exclude<TemplateZone, "endurance">, prefer: Focus[], seed: number): Template {
  const all = templatesFor(zone);
  const preferred = prefer.length ? all.filter((t) => t.focus.some((f) => prefer.includes(f))) : all;
  const pool = preferred.length ? preferred : all;
  return pool[((Math.round(seed) % pool.length) + pool.length) % pool.length];
}

/**
 * Checks targets set directly for a structure: known names, inside each one's range. Throws with a
 * message the coach can act on. Counts are rounded; durations to whole seconds.
 */
export function checkTweaks(template: Template, tweaks: Params): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(tweaks)) {
    const param = template.params.find((x) => x.key === key);
    if (!param) throw new Error(`${template.name} has no target "${key}"; it has ${template.params.map((x) => x.key).join(", ")}`);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
    if (value < param.min || value > param.max) throw new Error(`${key} must be between ${param.min} and ${param.max}`);
    out[key] = param.unit === "ftp" ? t2(value) : Math.round(value);
  }
  return out;
}

/** Tweaks kept inside their ranges, dropping unknown names (for stored sessions built before a change). */
export function clampTweaks(template: Template, tweaks: Params | undefined): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(tweaks ?? {})) {
    const param = template.params.find((x) => x.key === key);
    if (!param || typeof value !== "number" || !Number.isFinite(value)) continue;
    const clamped = Math.min(Math.max(value, param.min), param.max);
    out[key] = param.unit === "ftp" ? t2(clamped) : Math.round(clamped);
  }
  return out;
}
