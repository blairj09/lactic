/**
 * Turns Apple Health samples sent by the iPhone shortcut into one summary per morning.
 *
 * The shortcut sends each sample as a text line, `start|end|value` (or `start|value`), with dates in
 * ISO 8601 including the phone's UTC offset, e.g. `2026-11-02T06:48:00-05:00|2026-11-02T06:52:00-05:00|REM`.
 * Lists come newline-joined. A night belongs to the local date it ends on (the offset in its own
 * timestamps), so no time zone is needed.
 */

export type SleepStage = "deep" | "rem" | "core" | "asleep" | "awake";

export interface HealthNight {
  /** The local date the night ended on (YYYY-MM-DD). */
  day: string;
  /** Unix seconds. First and last moment of sleep; null on a date with only a resting HR. */
  start: number | null;
  end: number | null;
  asleepHours: number | null;
  /** Stage hours, null when the source doesn't stage sleep. Core includes unstaged "asleep" time. */
  deepHours: number | null;
  remHours: number | null;
  coreHours: number | null;
  awakeHours: number | null;
  /** Mean of the HRV samples taken during the night, ms. */
  hrv: number | null;
  /** Apple's resting heart rate for that date, bpm. */
  restingHr: number | null;
  /** Apple Watch sleeping wrist temperature, °C (absolute; only the change against normal means much). */
  wristTempC: number | null;
  /** Mean breathing rate during the night, breaths per minute. */
  respiratoryRate: number | null;
  /** The night as a timeline: back-to-back stretches in one stage, unix seconds. Empty without a night. */
  segments: SleepSegment[];
}

export interface SleepSegment {
  start: number;
  end: number;
  stage: SleepStage;
}

interface Sample {
  start: number;
  end: number;
  /** The phone's UTC offset at `end`, minutes. */
  offsetMinutes: number;
  value: string;
}

/** Nights split where nothing was recorded for longer than this. */
const SESSION_GAP_SECONDS = 90 * 60;
/** HRV samples this close to a night still count for it (the watch often reads just before waking). */
const HRV_MARGIN_SECONDS = 30 * 60;

// When sources overlap (watch and phone, say), the most specific stage wins each moment; a plain
// "asleep" loses even to "awake", since only a staging source says awake mid-night.
const PRIORITY: SleepStage[] = ["deep", "rem", "core", "awake", "asleep"];

/** Parses one ISO 8601 date with its offset. Returns null for anything else. */
export function parseHealthDate(text: string): { unix: number; offsetMinutes: number } | null {
  const m = text.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return null;
  const zone = m[3] ?? "Z";
  const offsetMinutes = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
  const ms = Date.parse(`${m[1]}T${m[2]}${zone === "Z" ? "Z" : `${zone.slice(0, 3)}:${zone.slice(-2)}`}`);
  return Number.isFinite(ms) ? { unix: ms / 1000, offsetMinutes } : null;
}

/** What a sleep sample's value means. Shortcuts says "Core", "Deep", "REM", "Awake", "In Bed", "Asleep" (wording varies by iOS). */
export function sleepStage(value: string): SleepStage | "inBed" | null {
  const v = value.toLowerCase();
  if (v.includes("deep")) return "deep";
  if (v.includes("rem")) return "rem";
  if (v.includes("core") || v.includes("light")) return "core";
  if (v.includes("awake")) return "awake";
  if (v.includes("bed")) return "inBed";
  if (v.includes("asleep") || v.includes("unspecified") || v.includes("sleep")) return "asleep";
  return null;
}

/** Splits shortcut text into samples. Bad lines are skipped. Accepts a list too. */
function parseSamples(input: unknown): Sample[] {
  const lines = Array.isArray(input) ? input.map(String) : typeof input === "string" ? input.split(/\r?\n/) : [];
  const out: Sample[] = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;
    const start = parseHealthDate(parts[0]);
    const end = parts.length >= 3 ? parseHealthDate(parts[1]) : start;
    if (!start || !end || end.unix < start.unix || end.unix - start.unix > 24 * 3600) continue;
    out.push({ start: start.unix, end: end.unix, offsetMinutes: end.offsetMinutes, value: parts.at(-1)! });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** "62", "62 ms", "62,5" → 62.5; null if it isn't a number. */
function numberIn(value: string): number | null {
  const n = parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const localDay = (unix: number, offsetMinutes: number) => new Date((unix + offsetMinutes * 60) * 1000).toISOString().slice(0, 10);

/**
 * Builds one night per morning from sleep, HRV and resting heart rate samples. Where a morning has
 * more than one sleep (a nap), the one with the most sleep is the night. Oldest first.
 */
export function healthNights(input: {
  sleep?: unknown;
  hrv?: unknown;
  restingHr?: unknown;
  wristTemp?: unknown;
  respiratoryRate?: unknown;
}): HealthNight[] {
  const staged = parseSamples(input.sleep).flatMap((s) => {
    const stage = sleepStage(s.value);
    return stage && stage !== "inBed" ? [{ ...s, stage }] : [];
  });

  // Group into sessions: runs of samples with no long gap between them.
  const sessions: (typeof staged)[] = [];
  for (const s of staged) {
    const current = sessions.at(-1);
    const currentEnd = current ? Math.max(...current.map((c) => c.end)) : -Infinity;
    if (current && s.start - currentEnd <= SESSION_GAP_SECONDS) current.push(s);
    else sessions.push([s]);
  }

  const hrvSamples = parseSamples(input.hrv).flatMap((s) => {
    const v = numberIn(s.value);
    return v !== null && v >= 1 && v <= 400 ? [{ ...s, v }] : [];
  });
  const rhrByDay = new Map<string, number>();
  for (const s of parseSamples(input.restingHr)) {
    const v = numberIn(s.value);
    // The latest sample for a date wins: Apple revises the day's resting HR as it goes.
    if (v !== null && v >= 25 && v <= 150) rhrByDay.set(localDay(s.start, s.offsetMinutes), v);
  }

  const respSamples = parseSamples(input.respiratoryRate).flatMap((s) => {
    const v = numberIn(s.value);
    return v !== null && v >= 4 && v <= 40 ? [{ ...s, v }] : [];
  });
  const tempSamples = parseSamples(input.wristTemp).flatMap((s) => {
    const v = numberIn(s.value);
    if (v === null) return [];
    // Shortcuts gives the phone's unit: Fahrenheit in the US.
    const c = v > 50 ? ((v - 32) * 5) / 9 : v;
    return c >= 25 && c <= 42 ? [{ ...s, c }] : [];
  });

  const best = new Map<string, HealthNight>();
  for (const session of sessions) {
    const { totals, segments } = timeline(session);
    const asleep = totals.deep + totals.rem + totals.core + totals.asleep;
    if (asleep < 30 * 60) continue;
    const sleeping = session.filter((s) => s.stage !== "awake");
    const start = Math.min(...sleeping.map((s) => s.start));
    const last = sleeping.reduce((a, b) => (b.end > a.end ? b : a));
    const day = localDay(last.end, last.offsetMinutes);
    const during = <T extends { start: number }>(list: T[]) =>
      list.filter((h) => h.start >= start - HRV_MARGIN_SECONDS && h.start <= last.end + HRV_MARGIN_SECONDS);
    const nightHrv = during(hrvSamples).map((h) => h.v);
    const nightResp = during(respSamples).map((h) => h.v);
    // The watch writes one wrist temperature per night, spanning the sleep; take the one that overlaps most.
    const temp = tempSamples
      .map((t) => ({ t, overlap: Math.min(t.end, last.end) - Math.max(t.start, start) }))
      .filter((x) => x.overlap > 0 || (x.t.start === x.t.end && x.t.start >= start - 3600 && x.t.start <= last.end + 3600))
      .sort((a, b) => b.overlap - a.overlap)[0]?.t;
    const avg = (v: number[], digits: number) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10 ** digits) / 10 ** digits : null);
    const staging = totals.deep + totals.rem + totals.core > 0;
    const hours = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
    const night: HealthNight = {
      day,
      start,
      end: last.end,
      asleepHours: hours(asleep),
      deepHours: staging ? hours(totals.deep) : null,
      remHours: staging ? hours(totals.rem) : null,
      coreHours: staging ? hours(totals.core + totals.asleep) : null,
      awakeHours: hours(totals.awake),
      hrv: avg(nightHrv, 1),
      restingHr: rhrByDay.get(day) ?? null,
      wristTempC: temp ? Math.round(temp.c * 100) / 100 : null,
      respiratoryRate: avg(nightResp, 1),
      segments,
    };
    const existing = best.get(day);
    if (!existing || night.asleepHours! > existing.asleepHours!) best.set(day, night);
  }

  // A date with a resting HR but no night recorded still gets its resting HR.
  for (const [day, restingHr] of rhrByDay)
    if (!best.has(day))
      best.set(day, {
        day,
        start: null,
        end: null,
        asleepHours: null,
        deepHours: null,
        remHours: null,
        coreHours: null,
        awakeHours: null,
        hrv: null,
        restingHr,
        wristTempC: null,
        respiratoryRate: null,
        segments: [],
      });

  return [...best.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Seconds in each stage, each moment counted once under its most specific stage, and the night as
 * back-to-back segments (neighbours in the same stage joined).
 */
function timeline(samples: { start: number; end: number; stage: SleepStage }[]): { totals: Record<SleepStage, number>; segments: SleepSegment[] } {
  const totals: Record<SleepStage, number> = { deep: 0, rem: 0, core: 0, asleep: 0, awake: 0 };
  const segments: SleepSegment[] = [];
  const edges = [...new Set(samples.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  for (let i = 0; i + 1 < edges.length; i++) {
    const [a, b] = [edges[i], edges[i + 1]];
    let winner: SleepStage | null = null;
    for (const s of samples)
      if (s.start <= a && s.end >= b && (winner === null || PRIORITY.indexOf(s.stage) < PRIORITY.indexOf(winner))) winner = s.stage;
    if (!winner) continue;
    totals[winner] += b - a;
    const prev = segments.at(-1);
    if (prev && prev.stage === winner && prev.end === a) prev.end = b;
    else segments.push({ start: a, end: b, stage: winner });
  }
  return { totals, segments };
}

/**
 * Health Auto Export's REST JSON (`{ data: { metrics: [{ name, data: [...] }] } }`) as shortcut-style
 * sample lines, so both go through `healthNights`. Sleep can come unsummarized (one entry per stage,
 * best) or summarized per night, which becomes back-to-back stage blocks between sleepStart and sleepEnd.
 * Returns null when the body isn't in that shape.
 */
export function autoExportSamples(
  body: unknown,
): { sleep: string[]; hrv: string[]; restingHr: string[]; wristTemp: string[]; respiratoryRate: string[] } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metrics = (body as any)?.data?.metrics;
  if (!Array.isArray(metrics)) return null;
  const out = { sleep: [] as string[], hrv: [] as string[], restingHr: [] as string[], wristTemp: [] as string[], respiratoryRate: [] as string[] };
  for (const metric of metrics) {
    const points: Record<string, unknown>[] = Array.isArray(metric?.data) ? metric.data : [];
    const name = String(metric?.name ?? "");
    const pointTargets: Record<string, string[]> = {
      heart_rate_variability: out.hrv,
      resting_heart_rate: out.restingHr,
      respiratory_rate: out.respiratoryRate,
      apple_sleeping_wrist_temperature: out.wristTemp,
    };
    if (name in pointTargets) {
      const target = pointTargets[name];
      for (const p of points) if (typeof p.date === "string" && p.qty !== undefined) target.push(`${p.date}|${p.qty}`);
    } else if (name === "sleep_analysis") {
      for (const p of points) {
        const start = p.startDate ?? p.start;
        const end = p.endDate ?? p.end;
        if (typeof start === "string" && typeof end === "string" && typeof p.value === "string") out.sleep.push(`${start}|${end}|${p.value}`);
        else if (typeof p.sleepStart === "string" && typeof p.sleepEnd === "string") out.sleep.push(...summarizedNight(p));
      }
    }
  }
  return out;
}

function summarizedNight(p: Record<string, unknown>): string[] {
  const from = parseHealthDate(String(p.sleepStart));
  const to = parseHealthDate(String(p.sleepEnd));
  if (!from || !to || to.unix <= from.unix) return [];
  const hours = (k: string) => (typeof p[k] === "number" && (p[k] as number) > 0 ? (p[k] as number) : 0);
  const blocks: [string, number][] = [
    ["Deep", hours("deep")],
    ["REM", hours("rem")],
    ["Core", hours("core")],
    ["Asleep", hours("asleep")],
    ["Awake", hours("awake")],
  ];
  if (blocks.every(([, h]) => h === 0)) blocks.push(["Asleep", hours("totalSleep") || (to.unix - from.unix) / 3600]);
  const iso = (unix: number) => {
    const local = new Date((unix + to.offsetMinutes * 60) * 1000).toISOString().slice(0, 19);
    const sign = to.offsetMinutes < 0 ? "-" : "+";
    const abs = Math.abs(to.offsetMinutes);
    return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  };
  const lines: string[] = [];
  let at = from.unix;
  for (const [stage, h] of blocks) {
    if (!h) continue;
    const next = Math.min(at + h * 3600, to.unix);
    if (next > at) lines.push(`${iso(at)}|${iso(next)}|${stage}`);
    at = next;
  }
  return lines;
}

/**
 * The loop-free shortcut sends each sample property as its own newline-joined list (Get Details of
 * Health Samples on the whole list), e.g. sleepStart / sleepEnd / sleepValue. This pairs them back up,
 * item by item, into sample lines. Lists of unequal length throw, since they can't be paired safely.
 */
export function columnSamples(
  body: Record<string, unknown>,
): { sleep: string[]; hrv: string[]; restingHr: string[]; wristTemp: string[]; respiratoryRate: string[] } | null {
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const zip = (...columns: string[][]) => {
    if (columns.some((c) => c.length !== columns[0].length)) throw new Error("Sample lists differ in length");
    return columns[0].map((_, i) => columns.map((c) => c[i]).join("|"));
  };
  if (!("sleepStart" in body || "hrvDate" in body || "restingHrDate" in body || "respRateDate" in body || "wristTempStart" in body)) return null;
  return {
    sleep: zip(list(body.sleepStart), list(body.sleepEnd), list(body.sleepValue)),
    hrv: zip(list(body.hrvDate), list(body.hrvValue)),
    restingHr: zip(list(body.restingHrDate), list(body.restingHrValue)),
    // Wrist temperature spans the night, so it carries an end too.
    wristTemp: zip(list(body.wristTempStart), list(body.wristTempEnd), list(body.wristTempValue)),
    respiratoryRate: zip(list(body.respRateDate), list(body.respRateValue)),
  };
}

/** One local day of daytime data from Apple Health: heart rate by minute, energy, steps, VO2 max. */
export interface HealthDay {
  day: string;
  /** 1,440 entries, local midnight first: that minute's heart rate (bpm) or null when nothing was recorded. */
  hrMinutes: (number | null)[];
  activeKcal: number | null;
  steps: number | null;
  /** Apple's cardio fitness estimate, ml/kg/min (the latest that day). */
  vo2max: number | null;
}

export const MINUTES_PER_DAY = 1440;
/** The watch samples heart rate every few minutes at rest; each reading stands for up to this long. */
const HR_HOLD_MINUTES = 10;

/**
 * Builds one day per local date from heart rate, active energy, step and VO2 max samples (the same
 * `start|end|value` lines as the night data). Heart rate goes onto a minute grid, each reading held
 * until the next one or for `HR_HOLD_MINUTES`; energy and steps are summed per date, so samples grouped
 * by day and raw samples both work. Oldest first.
 */
export function healthDays(input: { heartRate?: unknown; activeEnergy?: unknown; steps?: unknown; vo2max?: unknown }): HealthDay[] {
  const days = new Map<string, HealthDay>();
  const dayOf = (day: string) => {
    let d = days.get(day);
    if (!d) days.set(day, (d = { day, hrMinutes: new Array(MINUTES_PER_DAY).fill(null), activeKcal: null, steps: null, vo2max: null }));
    return d;
  };

  // Heart rate: mean per local minute (absolute minute numbers in local time), then held forward.
  const sums = new Map<number, { sum: number; count: number }>();
  for (const s of parseSamples(input.heartRate)) {
    const v = numberIn(s.value);
    if (v === null || v < 25 || v > 240) continue;
    const minute = Math.floor((s.start + s.offsetMinutes * 60) / 60);
    const m = sums.get(minute) ?? { sum: 0, count: 0 };
    m.sum += v;
    m.count++;
    sums.set(minute, m);
  }
  const minutes = [...sums.keys()].sort((a, b) => a - b);
  minutes.forEach((minute, i) => {
    const { sum, count } = sums.get(minute)!;
    const bpm = Math.round(sum / count);
    const until = Math.min(minutes[i + 1] ?? Infinity, minute + HR_HOLD_MINUTES);
    for (let m = minute; m < until; m++) {
      const day = new Date(m * 60_000).toISOString().slice(0, 10);
      dayOf(day).hrMinutes[((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY] = bpm;
    }
  });

  const total = (lines: unknown, key: "activeKcal" | "steps", max: number) => {
    for (const s of parseSamples(lines)) {
      const v = numberIn(s.value);
      if (v === null || v < 0 || v > max) continue;
      const d = dayOf(localDay(s.start, s.offsetMinutes));
      d[key] = (d[key] ?? 0) + v;
    }
  };
  total(input.activeEnergy, "activeKcal", 20_000);
  total(input.steps, "steps", 200_000);
  for (const d of days.values()) {
    if (d.activeKcal !== null) d.activeKcal = Math.round(d.activeKcal);
    if (d.steps !== null) d.steps = Math.round(d.steps);
  }
  for (const s of parseSamples(input.vo2max)) {
    const v = numberIn(s.value);
    if (v !== null && v >= 10 && v <= 95) dayOf(localDay(s.start, s.offsetMinutes)).vo2max = Math.round(v * 10) / 10;
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The loop-free shortcut's daytime lists (heartRateDate/Value, activeEnergyDate/Value, stepsDate/Value,
 * vo2maxDate/Value) as sample lines. Null when none are in the body.
 */
export function columnDaySamples(body: Record<string, unknown>): { heartRate: string[]; activeEnergy: string[]; steps: string[]; vo2max: string[] } | null {
  if (!["heartRateDate", "activeEnergyDate", "stepsDate", "vo2maxDate"].some((k) => k in body)) return null;
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  const zip = (dates: unknown, values: unknown) => {
    const a = list(dates);
    const b = list(values);
    if (a.length !== b.length) throw new Error("Sample lists differ in length");
    return a.map((d, i) => `${d}|${b[i]}`);
  };
  return {
    heartRate: zip(body.heartRateDate, body.heartRateValue),
    activeEnergy: zip(body.activeEnergyDate, body.activeEnergyValue),
    steps: zip(body.stepsDate, body.stepsValue),
    vo2max: zip(body.vo2maxDate, body.vo2maxValue),
  };
}
