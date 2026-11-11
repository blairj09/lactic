"use client";

import Link from "next/link";
import { Panel } from "@/components/ui";
import { SleepStrip } from "@/components/sleep-charts";
import { useChartWidth } from "@/components/chart-utils";
import { MINIMUM_BASELINE_DAYS, recoveryWord } from "@/lib/engine/recovery";
import { CONCERN_SIDE, type ExertionToday, type GlanceKey, type GlanceMetric } from "@/lib/engine/recovery-glance";
import type { RecoveryToday } from "@/lib/recovery-data";
import type { RecoverySourceInfo } from "@/lib/recovery-source";
import { formatHours } from "@/lib/engine/hours";
import { tempDeltaIn, temperatureUnit, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

/**
 * Last night, the one home for it (on Health): the recovery score with its week, each measure's last
 * two weeks against your usual range, and the night's sleep. Today shows a summary that links here.
 * Every number is the engine's (recovery-glance.ts, recovery.ts, sleep-score.ts); this only lays them out.
 */
export default function LastNight({
  recovery,
  source,
  timeZone,
  hrefs,
  exertionUsual = null,
}: {
  recovery: RecoveryToday;
  source: RecoverySourceInfo | null;
  timeZone: string;
  /** Each part opens its history. */
  hrefs?: Partial<Record<GlanceKey | "recovery", string>>;
  /** Your usual day's exertion (the mean), shown in place of a range that spans rest days and big days. */
  exertionUsual?: number | null;
}) {
  const units = useUnits();
  const { glance, score } = recovery;
  const rows = glance.metrics.filter((m) => m.nights.some((n) => n.value !== null));

  return (
    <Panel title="Last night" meta={<SourceLine recovery={recovery} source={source} />}>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-[16rem_minmax(0,1.5fr)_minmax(0,0.8fr)]">
        <div className="bg-surface p-4">
          <div className="flex items-center gap-4">
            <ScoreRing score={score?.score ?? null} />
            <div className="min-w-0">
              <div className="text-sm text-muted">{hrefs?.recovery ? <Link href={hrefs.recovery} className="hover:text-ink">Recovery ›</Link> : "Recovery"}</div>
              {score ? (
                <>
                  <div className="text-xl font-medium capitalize">{recoveryWord(score.score)}</div>
                  <div className="text-sm text-muted">{score.reasons[0] ?? "50 is a normal day for you"}</div>
                </>
              ) : (
                <div className="text-sm text-muted">
                  Building your baseline: {recovery.baselineDays} of {MINIMUM_BASELINE_DAYS} nights.
                </div>
              )}
            </div>
          </div>
          <WeekBars scores={glance.scores} />
          {glance.signals.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-warning">
              {glance.signals.map((s) => (
                <li key={s.id}>{s.reason}.</li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-surface p-4">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm text-muted">
            <span>Last 14 nights</span>
            <span className="flex items-center gap-1.5 text-xs">
              <span className="inline-block h-2 w-3.5 rounded-sm bg-accent-soft" aria-hidden />
              your usual range
            </span>
          </div>
          {rows.map((m) => (
            <MetricRow key={m.key} metric={m} units={units} href={hrefs?.[m.key]} usualDay={m.key === "exertion" ? exertionUsual : null} />
          ))}
        </div>

        <SleepCell recovery={recovery} timeZone={timeZone} href={hrefs?.sleepHours} />
      </div>
    </Panel>
  );
}

function SourceLine({ recovery, source }: { recovery: RecoveryToday; source: RecoverySourceInfo | null }) {
  const iphone = source?.iphone;
  const text = iphone
    ? iphone.here
      ? `Read from Health on this iPhone, ${clock(iphone.readAt)}`
      : `From your iPhone, read ${clock(iphone.readAt)}`
    : recovery.source === "intervals"
      ? "From intervals.icu"
      : recovery.source
        ? "From Apple Health"
        : null;
  if (!text) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block size-1.5 rounded-full bg-accent" aria-hidden />
      {text}
    </span>
  );
}

function clock(iso: string) {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return at.toLocaleString("en-US", sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function ScoreRing({ score, size = 88 }: { score: number | null; size?: number }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className="shrink-0" role="img" aria-label={score === null ? "No recovery score yet" : `Recovery ${score} of 100`}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="var(--raised)" strokeWidth="9" />
      {score !== null && (
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={score < 34 ? "var(--warning)" : "var(--accent)"}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(Math.max(score, 1) / 100) * circumference} ${circumference}`}
          transform="rotate(-90 48 48)"
        />
      )}
      <text x="48" y="48" dy="0.35em" textAnchor="middle" className="num fill-ink text-[26px] font-semibold">
        {score ?? "–"}
      </text>
    </svg>
  );
}

const WEEKDAY = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" });

export function WeekBars({ scores, label = true, height = 40 }: { scores: { day: string; score: number | null }[]; label?: boolean; height?: number }) {
  if (scores.filter((s) => s.score !== null).length < 2) return null;
  const last = scores.at(-1)!;
  return (
    <div className="mt-4 flex items-end gap-1.5" role="img" aria-label={`Recovery the last 7 mornings: ${scores.map((s) => s.score ?? "none").join(", ")}`}>
      {scores.map((s, i) => (
        <div key={s.day} className="flex flex-col items-center gap-1 text-[11px] text-faint">
          <div
            className={i === scores.length - 1 ? "w-5 rounded-sm bg-accent" : "w-5 rounded-sm bg-accent-soft"}
            style={{ height: s.score === null ? 2 : Math.max(3, (s.score / 100) * height) }}
          />
          <span className={i === scores.length - 1 ? "text-ink" : undefined}>{WEEKDAY(s.day)}</span>
        </div>
      ))}
      {label && last.score !== null && <span className="ml-2 self-center text-xs text-muted">Last 7 mornings</span>}
    </div>
  );
}

const LABEL: Record<GlanceKey, string> = {
  hrv: "HRV",
  restingHeartRate: "Resting HR",
  sleepHours: "Sleep",
  respiratoryRate: "Breathing",
  wristTemp: "Wrist temp",
  exertion: "Exertion",
};

function format(key: GlanceKey, value: number, units: UnitSystem, withUnit = true): string {
  switch (key) {
    case "hrv":
      return `${Math.round(value)}${withUnit ? " ms" : ""}`;
    case "restingHeartRate":
      return `${Math.round(value)}${withUnit ? " bpm" : ""}`;
    case "sleepHours":
      return hm(value);
    case "respiratoryRate":
      return value.toFixed(1);
    case "wristTemp": {
      const v = tempDeltaIn(value, units);
      return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${withUnit ? ` ${temperatureUnit(units)}` : ""}`;
    }
    case "exertion":
      return value.toFixed(1);
  }
}

const hm = formatHours;

function MetricRow({ metric, units, href, usualDay }: { metric: GlanceMetric; units: UnitSystem; href?: string; usualDay: number | null }) {
  const { key, value, range, concern } = metric;
  const label = (
    <>
      {LABEL[key]}
      {key === "exertion" && <span className="block text-xs text-muted">yesterday</span>}
    </>
  );
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-rule py-1.5 last:border-b-0 sm:grid-cols-[6rem_minmax(0,1fr)_12rem]">
      {href ? (
        <Link href={href} className="text-sm hover:underline hover:underline-offset-4">
          {label}
        </Link>
      ) : (
        <span className="text-sm">{label}</span>
      )}
      <Spark metric={metric} />
      <span className="num text-right text-sm whitespace-nowrap">
        <span className={concern ? "font-medium text-warning" : "font-medium text-ink"}>{value === null ? "–" : format(key, value, units)}</span>
        {key === "exertion" ? (
          usualDay !== null && <span className="block text-xs text-muted sm:inline sm:text-sm">{" "}usual day {usualDay.toFixed(1)}</span>
        ) : (
          range && <span className="block text-xs text-muted sm:inline sm:text-sm">{" "}usual {usual(key, range, units)}</span>
        )}
      </span>
    </div>
  );
}

/** "55–69 ms", "7h 11m–8h 06m": one baseline wording, unit at the end. */
export function usual(key: GlanceKey, range: { low: number; high: number }, units: UnitSystem) {
  return `${format(key, range.low, units, false)}${key === "wristTemp" ? " to " : "–"}${format(key, range.high, units)}`;
}

const SPARK_HEIGHT = 30;

/** Two weeks as a line over the shaded usual range; nights outside it on the poorer side get an orange dot. */
function Spark({ metric }: { metric: GlanceMetric }) {
  const { ref, width } = useChartWidth(200, 80);
  const { nights, range } = metric;
  const values = nights.flatMap((n) => (n.value === null ? [] : [n.value]));
  const lo = Math.min(...values, ...(range ? [range.low] : []));
  const hi = Math.max(...values, ...(range ? [range.high] : []));
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  const y = (v: number) => SPARK_HEIGHT - 4 - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (SPARK_HEIGHT - 8);
  const x = (i: number) => 4 + (i / Math.max(nights.length - 1, 1)) * (width - 8);
  const side = CONCERN_SIDE[metric.key];
  const isOut = (v: number) => range !== null && (side === "low" ? v < range.low : v > range.high);

  // Gaps break the line.
  const paths: string[] = [];
  let current = "";
  nights.forEach((n, i) => {
    if (n.value === null) {
      if (current) paths.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(n.value).toFixed(1)}`;
  });
  if (current) paths.push(current);
  const lastIndex = nights.length - 1;
  const last = nights[lastIndex];

  return (
    <div ref={ref} className="min-w-0">
      <svg width={width} height={SPARK_HEIGHT} className="block overflow-visible" aria-hidden>
        {range && <rect x={0} y={y(range.high)} width={width} height={Math.max(y(range.low) - y(range.high), 2)} rx={3} fill="var(--accent-soft)" />}
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" />
        ))}
        {nights.map((n, i) =>
          n.value !== null && i !== lastIndex && isOut(n.value) ? <circle key={n.day} cx={x(i)} cy={y(n.value)} r={2.2} fill="var(--warning)" /> : null,
        )}
        {last.value !== null && <circle cx={x(lastIndex)} cy={y(last.value)} r={3.5} fill={isOut(last.value) ? "var(--warning)" : "var(--accent)"} />}
      </svg>
    </div>
  );
}

/**
 * Sleep in two lines that can't contradict each other: last night against your need, then the week's
 * running debt and what tonight should be. ("Score 99" next to "3h sleep debt" read as a contradiction.)
 */
export function sleepLines(glance: RecoveryToday["glance"]): string[] {
  const lines: string[] = [];
  if (glance.sleepScore) lines.push(`${glance.sleepScore.measures.ofNeed}% of your need`);
  if (glance.sleepDebtHours !== null)
    lines.push(glance.sleepDebtHours > 0 ? `${hm(glance.sleepDebtHours)} short this week · aim for ${hm(glance.sleepNeedTonight)} tonight` : `On track this week · aim for ${hm(glance.sleepNeedTonight)} tonight`);
  return lines;
}

function SleepCell({ recovery, timeZone, href }: { recovery: RecoveryToday; timeZone: string; href?: string }) {
  const { glance, sleep, today } = recovery;
  const hours = today?.sleepHours;
  const segments = sleep?.segments ?? [];
  const at = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return (
    <div className="bg-surface p-4">
      <div className="flex items-baseline justify-between text-sm text-muted">
        {href ? <Link href={href} className="hover:text-ink">Sleep ›</Link> : <span>Sleep</span>}
        {glance.sleepScore && (
          <span>
            Score <span className="num font-medium text-ink">{glance.sleepScore.score}</span>
          </span>
        )}
      </div>
      {hours != null ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="num text-2xl font-medium tracking-tight">{hm(hours)}</span>
          {sleep?.start && sleep.end && segments.length === 0 && (
            <span className="text-sm text-muted">
              {at(sleep.start)} to {at(sleep.end)}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted">No sleep recorded last night.</div>
      )}
      {segments.length > 0 && (
        <div className="mt-3">
          <SleepStrip segments={segments} timeZone={timeZone} />
        </div>
      )}
      <div className="mt-3 space-y-0.5 text-sm text-muted">
        {sleepLines(glance).map((l) => (
          <p key={l}>{l}</p>
        ))}
      </div>
    </div>
  );
}

const BAR_MAX = 8;

/**
 * One line on today's exertion. On an eased day (a recovery week or a safety rule) the plan already
 * decided the day is easy, so the line doesn't call the ride "under target": it defers to the plan.
 */
export function exertionLine(exertion: ExertionToday, eased: boolean): string {
  const { soFar, target, planned } = exertion;
  const now = soFar ?? 0;
  if (planned && eased) return `Easy on purpose today. The ride adds about ${planned.add.toFixed(1)} exertion.`;
  if (planned && target) {
    const where = planned.landsAt < target.low ? "under" : planned.landsAt > target.high ? "over" : "inside";
    return `The ride lands you at ${planned.landsAt.toFixed(1)} exertion, ${where} today's ${target.low.toFixed(1)}–${target.high.toFixed(1)}.`;
  }
  if (target && soFar !== null) {
    return soFar > target.high
      ? `${soFar.toFixed(1)}: over today's target. Keep the rest of the day easy.`
      : soFar >= target.low
        ? `${soFar.toFixed(1)}: target reached.`
        : `${soFar.toFixed(1)} so far, ${(target.low - soFar).toFixed(1)} under today's target.`;
  }
  return `${now.toFixed(1)} so far. A target shows once your recovery score and usual day are in.`;
}

/** Today's exertion so far against the target, with what the planned ride should add striped. */
export function ExertionBar({ exertion, eased = false, compact = false }: { exertion: ExertionToday; eased?: boolean; compact?: boolean }) {
  const { soFar, target, planned } = exertion;
  const max = Math.max(BAR_MAX, Math.ceil(Math.max(soFar ?? 0, planned?.landsAt ?? 0, target?.high ?? 0)));
  const pct = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  const now = soFar ?? 0;
  const ticks = Array.from({ length: max / 2 + 1 }, (_, i) => i * 2);

  const line = exertionLine(exertion, eased);
  const bar = (h: string) => (
    <div className={`relative ${h} overflow-hidden rounded bg-raised`} role="img" aria-label={line}>
      {target && <span className="absolute inset-y-0 border-x border-accent bg-accent-soft" style={{ left: pct(target.low), width: `calc(${pct(target.high)} - ${pct(target.low)})` }} />}
      <span className="absolute inset-y-0.5 left-0 rounded-sm bg-accent" style={{ width: pct(now) }} />
      {planned && planned.add > 0 && (
        <span
          className="absolute inset-y-0.5 rounded-r-sm opacity-60"
          style={{ left: pct(now), width: `calc(${pct(now + planned.add)} - ${pct(now)})`, background: "repeating-linear-gradient(135deg, var(--accent) 0 3px, transparent 3px 7px)" }}
        />
      )}
    </div>
  );

  // In the workout card: the bar and its line, nothing else.
  if (compact)
    return (
      <div className="space-y-1.5">
        {bar("h-3")}
        <p className="text-sm text-muted">{line}</p>
      </div>
    );

  return (
    <div className="mt-4 border-t border-rule pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
        <span>
          <span className="font-medium">Exertion today</span>
          {target && (
            <span className="text-muted">
              {" "}
              target {target.low.toFixed(1)} to {target.high.toFixed(1)}, from your recovery
            </span>
          )}
        </span>
        <span className="text-xs text-muted">0 to 10, from heart rate all day</span>
      </div>
      <div className="relative h-5 overflow-hidden rounded bg-raised" role="img" aria-label={line}>
        {target && <span className="absolute inset-y-0 border-x border-accent bg-accent-soft" style={{ left: pct(target.low), width: `calc(${pct(target.high)} - ${pct(target.low)})` }} />}
        <span className="absolute inset-y-1 left-0 rounded-sm bg-accent" style={{ width: pct(now) }} />
        {planned && planned.add > 0 && (
          <span
            className="absolute inset-y-1 rounded-r-sm opacity-60"
            style={{
              left: pct(now),
              width: `calc(${pct(now + planned.add)} - ${pct(now)})`,
              background: "repeating-linear-gradient(135deg, var(--accent) 0 3px, transparent 3px 7px)",
            }}
          />
        )}
      </div>
      <div className="num relative mt-1 h-4 text-[11px] text-faint">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: pct(t) }}>
            {t}
          </span>
        ))}
      </div>
      <p className="mt-1 text-sm">{line}</p>
    </div>
  );
}
