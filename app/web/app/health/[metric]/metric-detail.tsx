import Link from "next/link";
import { Hypnogram, StageBars } from "@/components/sleep-charts";
import TrendChart from "@/components/trend-chart";
import { Dash, Notice, Panel, PageHeader, Stat, StatStrip } from "@/components/ui";
import { loadAthlete, loadRides, type Athlete } from "@/lib/activities";
import { loadBodyMeasurements, weighInOn } from "@/lib/body-data";
import { DAYTIME_DAYS, loadDaytime } from "@/lib/daytime-data";
import { localDate } from "@/lib/engine/activity";
import { ageOn } from "@/lib/engine/body";
import { averageVo2max, fitnessAge, vo2maxBands, vo2maxFromPower, vo2maxRating } from "@/lib/engine/fitness-age";
import { againstNormal, dataStart, recoveryBands, rollingBest, seriesStats, windowDays } from "@/lib/engine/health-detail";
import { addDays } from "@/lib/engine/pmc";
import { MINIMUM_BASELINE_DAYS, MINIMUM_TEMP_BASELINE_DAYS, recoveryWord, type RecoveryTrendDay } from "@/lib/engine/recovery";
import { formatDay, signed, signedFixed } from "@/lib/format";
import { healthSummary } from "@/lib/health-summary";
import { loadRecovery, loadRecoveryTrend } from "@/lib/recovery-data";
import { createClient } from "@/lib/supabase/server";
import { METRICS, RANGES, metricHref, type MetricKey } from "../metrics";
import { ExertionPanel, hoursMinutes, WeighInTable } from "../parts";

type Supabase = Awaited<ReturnType<typeof createClient>>;
interface Ctx {
  supabase: Supabase;
  athlete: Athlete;
  today: string;
  days: number;
}

const CHART_HEIGHT = 220;
/** Rides behind each day's VO2 max, as on the Progress page. */
const VO2_WINDOW = 90;

/** One metric up close: its history over the chosen range, what's behind it, and what it means. */
export default async function MetricDetail({ metric, days, inSheet = false }: { metric: MetricKey; days: number; inSheet?: boolean }) {
  const supabase = await createClient();
  const athlete = await loadAthlete(supabase);
  const ctx: Ctx = { supabase, athlete, today: localDate(new Date(), athlete.timezone), days };
  const info = METRICS[metric];

  let body: React.ReactNode;
  switch (metric) {
    case "recovery":
      body = await RecoveryDetail(ctx);
      break;
    case "exertion":
      body = await ExertionDetail(ctx);
      break;
    case "sleep-score":
      body = await SleepScoreDetail(ctx);
      break;
    case "sleep":
      body = await SleepDetail(ctx);
      break;
    case "fitness":
      body = await FitnessDetail(ctx);
      break;
    case "body":
      body = await BodyDetail(ctx);
      break;
    default:
      body = await NightlyDetail(ctx, metric);
  }

  return (
    <>
      <div className={inSheet ? "pr-10" : undefined}>
        <PageHeader title={info.title} line={info.line} actions={<RangeLinks metric={metric} days={days} />} />
      </div>
      {body}
      <Panel title="About this number">
        <div className="max-w-3xl space-y-3 text-[15px] text-muted">
          {info.about.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </Panel>
    </>
  );
}

function RangeLinks({ metric, days }: { metric: MetricKey; days: number }) {
  return (
    <div role="group" aria-label="Range" className="flex gap-0.5 rounded-md bg-raised p-0.5">
      {RANGES.map((r) => (
        <Link
          key={r.days}
          href={metricHref(metric, r.days)}
          replace
          scroll={false}
          aria-current={r.days === days ? "true" : undefined}
          className="flex h-8 items-center rounded px-2.5 text-sm whitespace-nowrap text-muted transition-colors hover:text-ink aria-[current]:bg-surface aria-[current]:font-medium aria-[current]:text-ink aria-[current]:shadow-[0_0_0_1px_var(--line)]"
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

/** The window's days, trimmed to start where the data does (at least 30 days shown). */
function shownWindow(today: string, days: number, series: (window: string[]) => (number | null)[][]) {
  const all = windowDays(today, days);
  const start = dataStart(series(all), Math.min(30, days));
  return all.slice(start);
}

const dayLabel = (day: string) => formatDay(new Date(`${day}T12:00:00Z`), "UTC");
const periodLabel = (window: string[]) => `${dayLabel(window[0])} to ${dayLabel(window.at(-1)!)}`;

function ChartPanel({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Panel title={title} meta={meta} className="min-w-0">
      {children}
    </Panel>
  );
}

interface Column {
  label: string;
  /** Hide on a phone to keep the table narrow. */
  wide?: boolean;
}

/** Newest first, one row a day, scrolling inside its panel. */
function DayTable({ title, columns, rows, empty = "Nothing recorded in this range.", noun = "day" }: { title: string; columns: Column[]; rows: { key: string; cells: React.ReactNode[] }[]; empty?: string; noun?: string }) {
  return (
    <Panel title={title} meta={rows.length ? `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}` : undefined} className="min-w-0">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="max-h-96 overflow-auto sm:max-h-[28rem]">
          <table className="num w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr>
                {columns.map((c, i) => (
                  <th key={c.label} className={`pb-2 font-normal ${i ? "text-right" : ""} ${c.wide ? "hidden sm:table-cell" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-rule">
                  {r.cells.map((cell, i) => (
                    <td key={i} className={`py-2.5 whitespace-nowrap ${i ? "pl-3 text-right" : ""} ${columns[i]?.wide ? "hidden sm:table-cell" : ""}`}>
                      {cell ?? <Dash />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const fixed = (v: number | null | undefined, decimals = 0, unit = "") =>
  v === null || v === undefined ? null : (
    <>
      {v.toFixed(decimals)}
      {unit && <span className="ml-1 text-muted">{unit}</span>}
    </>
  );

/** A row of labelled 0-100 bars (score parts, shares). */
function Bars({ rows }: { rows: { label: React.ReactNode; value: number | null; note?: React.ReactNode }[] }) {
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(6.5rem,auto)_1fr_auto] items-center gap-3 text-sm">
          <span className="text-muted">{r.label}</span>
          <span className="h-2 rounded-sm bg-rule">
            {r.value !== null && <span className="block h-2 rounded-sm" style={{ width: `${Math.max(0, Math.min(100, r.value))}%`, background: "var(--accent)" }} />}
          </span>
          <span className="num min-w-12 text-right">{r.note ?? (r.value === null ? <Dash /> : r.value)}</span>
        </div>
      ))}
    </div>
  );
}

async function recoveryData({ supabase, athlete, today, days }: Ctx, daytimeDays = DAYTIME_DAYS) {
  const daytimeLoad = loadDaytime(supabase, athlete, today, daytimeDays).catch((e) => (console.error(e), null));
  const [daytime, recovery, trend] = await Promise.all([
    daytimeLoad,
    loadRecovery(supabase, today, athlete.sleepNeedHours, daytimeLoad),
    loadRecoveryTrend(supabase, today, athlete.sleepNeedHours, days, daytimeLoad),
  ]);
  const byDay = new Map(trend.days.map((d) => [d.day, d]));
  const pick = (window: string[], f: (d: RecoveryTrendDay) => number | null) => window.map((day) => (byDay.has(day) ? f(byDay.get(day)!) : null));
  return { daytime, recovery, trend, byDay, pick };
}

// ---------------------------------------------------------------- recovery

async function RecoveryDetail(ctx: Ctx) {
  const { recovery, byDay, pick } = await recoveryData(ctx);
  const window = shownWindow(ctx.today, ctx.days, (w) => [pick(w, (d) => d.hrv), pick(w, (d) => d.score)]);
  const scores = pick(window, (d) => d.score);
  const stats = seriesStats(scores);
  const bands = recoveryBands(scores);
  const scored = bands.recovered + bands.normal + bands.under;
  const { score, today, baselineDays } = recovery;
  const share = (n: number) => (scored ? Math.round((n / scored) * 100) : 0);

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat lead label="Today" value={score ? score.score : <Dash />} unit={score ? recoveryWord(score.score) : undefined} sub={score ? undefined : today ? `Needs ${MINIMUM_BASELINE_DAYS} nights (${baselineDays} so far)` : "No night yet today"} />
        <Stat label="Average" value={stats.mean !== null ? Math.round(stats.mean) : <Dash />} sub={`${stats.count} morning${stats.count === 1 ? "" : "s"} scored`} />
        <Stat label="Lowest" value={stats.min ?? <Dash />} sub={stats.min !== null ? dayOf(window, scores, stats.min) : undefined} />
        <Stat label="Highest" value={stats.max ?? <Dash />} sub={stats.max !== null ? dayOf(window, scores, stats.max) : undefined} />
      </StatStrip>
      <ChartPanel title="Recovery by morning" meta={periodLabel(window)}>
        <TrendChart label="Recovery score by day" days={window} values={scores} domain={[0, 100]} normal={50} normalLabel="A normal day" height={CHART_HEIGHT} />
      </ChartPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="This morning" meta={score ? `${score.score}, ${recoveryWord(score.score)}` : undefined}>
          {score ? (
            <ul className="space-y-2 text-sm">
              {score.reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="mt-2 size-1.5 flex-none rounded-full bg-accent" aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{today ? `Score after ${MINIMUM_BASELINE_DAYS} nights of HRV.` : "Waiting for last night."}</p>
          )}
          <h3 className="mt-5 mb-2 text-sm font-medium">What goes into it</h3>
          <Bars
            rows={[
              { label: "HRV", value: 50, note: "50%" },
              { label: "Resting HR", value: 30, note: "30%" },
              { label: "Sleep", value: 20, note: "20%" },
              { label: "Breathing", value: 10, note: "10%" },
              { label: "Yesterday", value: 10, note: "10%" },
            ]}
          />
        </Panel>
        <Panel title="How your mornings split" meta={scored ? `${scored} scored` : undefined}>
          {scored ? (
            <Bars
              rows={[
                { label: "Recovered (67+)", value: share(bands.recovered), note: `${bands.recovered} · ${share(bands.recovered)}%` },
                { label: "Normal (34 to 66)", value: share(bands.normal), note: `${bands.normal} · ${share(bands.normal)}%` },
                { label: "Under-recovered", value: share(bands.under), note: `${bands.under} · ${share(bands.under)}%` },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No scored mornings in this range yet.</p>
          )}
        </Panel>
      </div>
      <DayTable
        title="Day by day"
        columns={[{ label: "Day" }, { label: "Score" }, { label: "HRV" }, { label: "Resting HR" }, { label: "Sleep", wide: true }, { label: "Breathing", wide: true }]}
        rows={[...window].reverse().flatMap((day) => {
          const d = byDay.get(day);
          if (!d) return [];
          return [
            {
              key: day,
              cells: [dayLabel(day), d.score, fixed(d.hrv, 0, "ms"), fixed(d.restingHeartRate, 0, "bpm"), d.sleepHours !== null ? hoursMinutes(d.sleepHours) : null, fixed(d.respiratoryRate, 1, "/min")],
            },
          ];
        })}
      />
    </>
  );
}

/** "Mon, Oct 6": the latest day a value occurred. */
function dayOf(window: string[], values: (number | null)[], value: number) {
  const i = values.findLastIndex((v) => v === value);
  return i >= 0 ? dayLabel(window[i]) : undefined;
}

// ---------------------------------------------------------------- exertion

async function ExertionDetail(ctx: Ctx) {
  const { daytime, recovery, trend } = await recoveryData(ctx, ctx.days + 30);
  const summary = healthSummary({
    athlete: ctx.athlete,
    today: ctx.today,
    daytime,
    trend: trend.days,
    nights: trend.nights,
    recovery: recovery.score?.score ?? null,
  });
  const { exertion } = summary;
  const values = (w: string[]) => w.map((day) => exertion.byDay.get(day) ?? null);
  const window = shownWindow(ctx.today, ctx.days, (w) => [values(w)]);
  const series = values(window);
  const stats = seriesStats(series);
  const y = exertion.yesterday;
  const hasWatch = daytime?.hasWatch ?? false;
  const byDay = new Map((daytime?.days ?? []).map((d) => [d.day, d]));

  return (
    <>
      {!hasWatch && <Notice>Exertion counts rides only. Send daytime heart rate from Apple Health to count the whole day.</Notice>}
      <StatStrip cols={4} phone={2}>
        <Stat lead label="Yesterday" value={y ? y.exertion.toFixed(1) : <Dash />} unit={y ? "/ 10" : undefined} sub={y ? `${Math.round(y.trimp)} TRIMP` : "No heart rate yesterday"} />
        <Stat label="Your normal" value={exertion.normal ? exertion.normal.mean.toFixed(1) : <Dash />} sub={exertion.normal ? `From ${exertion.normal.days} days` : "After a week of heart rate"} />
        <Stat label="Target today" value={exertion.target ? `${exertion.target.low.toFixed(1)}–${exertion.target.high.toFixed(1)}` : <Dash />} sub={exertion.target ? "From recovery and your normal" : "Needs recovery and a normal"} />
        <Stat label="Average" value={stats.mean !== null ? stats.mean.toFixed(1) : <Dash />} sub={`${stats.count} day${stats.count === 1 ? "" : "s"} counted`} />
      </StatStrip>
      <ChartPanel title="Exertion by day" meta={periodLabel(window)}>
        <TrendChart label="Exertion by day" days={window} values={series} domain={[0, 10]} normal={exertion.normal?.mean ?? null} normalLabel="Your normal day" decimals={1} height={CHART_HEIGHT} />
      </ChartPanel>
      <ExertionPanel exertion={exertion} activity={summary.activity} />
      <DayTable
        title="Day by day"
        columns={[{ label: "Day" }, { label: "Exertion" }, { label: "Bike TRIMP" }, { label: "Other TRIMP" }, { label: "Heart rate", wide: true }, { label: "Steps", wide: true }, { label: "Active", wide: true }]}
        rows={[...window].reverse().flatMap((day) => {
          const d = byDay.get(day);
          const act = daytime?.activity.get(day);
          if (!d && !act) return [];
          return [
            {
              key: day,
              cells: [
                dayLabel(day),
                exertion.byDay.has(day) ? exertion.byDay.get(day)!.toFixed(1) : null,
                d ? d.rideTrimp : null,
                d ? d.offBikeTrimp : null,
                d && d.coveredMinutes ? hoursMinutes(d.coveredMinutes / 60) : null,
                act?.steps != null ? act.steps.toLocaleString("en-US") : null,
                act?.activeKcal != null ? fixed(act.activeKcal, 0, "kcal") : null,
              ],
            },
          ];
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------- sleep score

async function SleepScoreDetail(ctx: Ctx) {
  const { daytime, recovery, trend } = await recoveryData(ctx);
  const summary = healthSummary({
    athlete: ctx.athlete,
    today: ctx.today,
    daytime,
    trend: trend.days,
    nights: trend.nights,
    recovery: recovery.score?.score ?? null,
  });
  const { sleep } = summary;
  const values = (w: string[]) => w.map((day) => sleep.byDay.get(day) ?? null);
  const window = shownWindow(ctx.today, ctx.days, (w) => [values(w)]);
  const series = values(window);
  const stats = seriesStats(series);
  const last = sleep.score;

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat lead label="Last night" value={last ? last.score : <Dash />} unit={last ? "/ 100" : undefined} sub={last ? undefined : "Waiting for last night"} />
        <Stat label="Average" value={stats.mean !== null ? Math.round(stats.mean) : <Dash />} sub={`${stats.count} night${stats.count === 1 ? "" : "s"}`} />
        <Stat label="Sleep debt" value={sleep.debtHours !== null ? (sleep.debtHours > 0 ? hoursMinutes(sleep.debtHours) : "None") : <Dash />} sub="Last 7 nights" />
        <Stat label="Need tonight" value={hoursMinutes(sleep.needTonight)} sub={`Usual need ${hoursMinutes(ctx.athlete.sleepNeedHours)}`} />
      </StatStrip>
      <ChartPanel title="Sleep score by night" meta={periodLabel(window)}>
        <TrendChart label="Sleep score by night" days={window} values={series} domain={[0, 100]} normal={stats.mean} normalLabel="Your average" height={CHART_HEIGHT} />
      </ChartPanel>
      <Panel title="Last night's parts" meta={last ? `Score ${last.score}` : undefined}>
        {last ? (
          <Bars
            rows={[
              { label: "Duration · 50%", value: last.parts.duration },
              { label: "Efficiency · 20%", value: last.parts.efficiency },
              { label: "Deep + REM · 20%", value: last.parts.restorative },
              { label: "Regularity · 10%", value: last.parts.regularity, note: last.parts.regularity !== null && sleep.spreadMinutes !== null ? `${last.parts.regularity} · ±${sleep.spreadMinutes} min` : undefined },
            ]}
          />
        ) : (
          <p className="text-sm text-muted">No night recorded yet.</p>
        )}
      </Panel>
      <DayTable
        title="Night by night"
        noun="night"
        columns={[{ label: "Night" }, { label: "Score" }, { label: "Duration" }, { label: "Efficiency", wide: true }, { label: "Deep + REM", wide: true }, { label: "Regularity", wide: true }]}
        rows={[...window].reverse().flatMap((day) => {
          const s = sleep.scores.get(day);
          if (!s) return [];
          return [{ key: day, cells: [dayLabel(day), s.score, s.parts.duration, s.parts.efficiency, s.parts.restorative, s.parts.regularity] }];
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------- sleep hours and stages

async function SleepDetail(ctx: Ctx) {
  const { recovery, trend, pick } = await recoveryData(ctx);
  const need = ctx.athlete.sleepNeedHours;
  const tz = ctx.athlete.timezone;
  const window = shownWindow(ctx.today, ctx.days, (w) => [pick(w, (d) => d.sleepHours)]);
  const hours = pick(window, (d) => d.sleepHours);
  const stats = seriesStats(hours);
  const short = hours.filter((h) => h !== null && h < need).length;
  const inWindow = new Set(window);
  const stages = trend.stages.filter((s) => inWindow.has(s.day));
  const stageMean = (f: (s: (typeof stages)[number]) => number | null) => seriesStats(stages.map(f)).mean;
  const avg = { deep: stageMean((s) => s.deepHours), core: stageMean((s) => s.coreHours), rem: stageMean((s) => s.remHours), awake: stageMean((s) => s.awakeHours) };
  const asleep = (avg.deep ?? 0) + (avg.core ?? 0) + (avg.rem ?? 0);
  const shareOf = (h: number | null) => (h !== null && asleep > 0 ? Math.round((h / asleep) * 100) : null);
  const nights = new Map(trend.nights.map((n) => [n.day, n]));
  const stageByDay = new Map(stages.map((s) => [s.day, s]));
  const clock = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : null);
  const segments = recovery.sleep?.segments ?? [];
  const hm = (h: number | null | undefined) => (h === null || h === undefined ? null : hoursMinutes(h));

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat lead label="Last night" value={hm(stats.latestIndex === window.length - 1 ? stats.latest : null) ?? <Dash />} sub={`Need ${hoursMinutes(need)}`} />
        <Stat label="Average" value={hm(stats.mean) ?? <Dash />} sub={`${stats.count} night${stats.count === 1 ? "" : "s"}`} />
        <Stat label="Short of need" value={stats.count ? short : <Dash />} unit={stats.count ? `night${short === 1 ? "" : "s"}` : undefined} sub={stats.count ? `${Math.round((short / stats.count) * 100)}% of nights` : undefined} />
        <Stat label="Range" value={stats.min !== null ? `${hoursMinutes(stats.min)}` : <Dash />} sub={stats.max !== null ? `to ${hoursMinutes(stats.max)}` : undefined} />
      </StatStrip>
      <ChartPanel title="Hours asleep" meta={periodLabel(window)}>
        <TrendChart label="Hours asleep by night" days={window} values={hours} normal={need} normalLabel="Your sleep need" unit="h" decimals={1} height={CHART_HEIGHT} />
      </ChartPanel>
      {segments.length > 0 && (
        <ChartPanel title="Last night's stages" meta={recovery.sleep?.start && recovery.sleep.end ? `${clock(recovery.sleep.start)} to ${clock(recovery.sleep.end)}` : undefined}>
          <Hypnogram segments={segments} timeZone={tz} />
        </ChartPanel>
      )}
      {stages.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <ChartPanel title="Stages by night" meta="Hours">
            <StageBars days={window} nights={stages} sleepNeedHours={need} />
          </ChartPanel>
          <Panel title="Average night" meta={`${stages.length} night${stages.length === 1 ? "" : "s"}`}>
            <Bars
              rows={[
                { label: "Deep", value: shareOf(avg.deep), note: avg.deep !== null ? `${hoursMinutes(avg.deep)} · ${shareOf(avg.deep)}%` : undefined },
                { label: "Core", value: shareOf(avg.core), note: avg.core !== null ? `${hoursMinutes(avg.core)} · ${shareOf(avg.core)}%` : undefined },
                { label: "REM", value: shareOf(avg.rem), note: avg.rem !== null ? `${hoursMinutes(avg.rem)} · ${shareOf(avg.rem)}%` : undefined },
                { label: "Awake", value: null, note: avg.awake !== null ? hoursMinutes(avg.awake) : undefined },
              ]}
            />
            <p className="mt-4 text-sm text-muted">Shares are of time asleep. Deep plus REM near 40% is typical for adults.</p>
          </Panel>
        </div>
      )}
      <DayTable
        title="Night by night"
        noun="night"
        columns={[{ label: "Night" }, { label: "Asleep" }, { label: "Bed" }, { label: "Up" }, { label: "Deep", wide: true }, { label: "REM", wide: true }, { label: "Core", wide: true }, { label: "Awake", wide: true }]}
        rows={[...window].reverse().flatMap((day, i) => {
          const h = hours[window.length - 1 - i];
          if (h === null) return [];
          const n = nights.get(day);
          const s = stageByDay.get(day);
          return [{ key: day, cells: [dayLabel(day), hoursMinutes(h), clock(n?.start ?? null), clock(n?.end ?? null), hm(s?.deepHours), hm(s?.remHours), hm(s?.coreHours), hm(s?.awakeHours)] }];
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------- HRV, resting HR, breathing, wrist temp

const NIGHTLY = {
  hrv: { pick: (d: RecoveryTrendDay) => d.hrv, unit: "ms", decimals: 0, compare: "percent", chart: "HRV by night" },
  "resting-hr": { pick: (d: RecoveryTrendDay) => d.restingHeartRate, unit: "bpm", decimals: 0, compare: "difference", chart: "Resting heart rate by night" },
  breathing: { pick: (d: RecoveryTrendDay) => d.respiratoryRate, unit: "/min", decimals: 1, compare: "difference", chart: "Breathing rate by night" },
  "wrist-temp": { pick: (d: RecoveryTrendDay) => d.wristTempDeltaC, unit: "°C", decimals: 1, compare: null, chart: "Wrist temperature against normal by night" },
} as const;

async function NightlyDetail(ctx: Ctx, metric: MetricKey) {
  const config = NIGHTLY[metric as keyof typeof NIGHTLY];
  const { recovery, trend, pick } = await recoveryData(ctx);
  const window = shownWindow(ctx.today, ctx.days, (w) => [pick(w, config.pick)]);
  const values = pick(window, config.pick);
  const stats = seriesStats(values);
  const normal =
    metric === "hrv" ? trend.normals.hrv : metric === "resting-hr" ? trend.normals.restingHeartRate : metric === "breathing" ? trend.normals.respiratoryRate : 0;
  const isTemp = metric === "wrist-temp";
  const unitGap = config.unit.startsWith("/") ? "" : " ";
  const show = (v: number | null) => (v === null ? null : `${isTemp ? signedFixed(v) : v.toFixed(config.decimals)}${unitGap}${config.unit}`);
  const lastNight = stats.latestIndex === values.length - 1 ? stats.latest : null;
  const vsNormal = (v: number | null) => {
    if (!config.compare) return null;
    const d = againstNormal(v, normal, config.compare);
    if (d === null) return null;
    return config.compare === "percent" ? `${signed(d)}%` : config.decimals ? signedFixed(d) : signed(d);
  };
  const kind = metric === "hrv" ? (recovery.today?.hrvKind === "rmssd" ? "RMSSD" : "SDNN") : null;
  const needs = isTemp || metric === "breathing" ? MINIMUM_TEMP_BASELINE_DAYS : MINIMUM_BASELINE_DAYS;

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat
          lead
          label="Last night"
          value={lastNight !== null ? (isTemp ? signedFixed(lastNight) : lastNight.toFixed(config.decimals)) : <Dash />}
          unit={lastNight !== null ? config.unit : undefined}
          sub={lastNight !== null && config.compare && normal !== null ? `${vsNormal(lastNight)} against normal` : kind ?? undefined}
        />
        <Stat
          label={isTemp ? "Normal" : "Your normal"}
          value={isTemp ? "0.0" : normal !== null ? normal.toFixed(config.decimals) : <Dash />}
          unit={isTemp || normal !== null ? config.unit : undefined}
          sub={isTemp ? "Your own wrist-temp normal" : normal !== null ? "Last 60 days" : `After ${needs} nights`}
        />
        <Stat label="Average" value={show(stats.mean) ?? <Dash />} sub={`${stats.count} night${stats.count === 1 ? "" : "s"}`} />
        <Stat label="Range" value={show(stats.min) ?? <Dash />} sub={stats.max !== null ? `to ${show(stats.max)}` : undefined} />
      </StatStrip>
      <ChartPanel title={METRICS[metric].title} meta={periodLabel(window)}>
        <TrendChart
          label={config.chart}
          days={window}
          values={values}
          normal={normal}
          normalLabel={isTemp ? "Your normal" : undefined}
          unit={config.unit}
          decimals={config.decimals}
          signed={isTemp}
          height={CHART_HEIGHT}
        />
      </ChartPanel>
      <DayTable
        title="Night by night"
        noun="night"
        columns={[{ label: "Night" }, { label: isTemp ? "Against normal" : METRICS[metric].title }, ...(config.compare ? [{ label: "Against normal" }] : [])]}
        rows={[...window].reverse().flatMap((day, i) => {
          const v = values[window.length - 1 - i];
          if (v === null) return [];
          return [{ key: day, cells: [dayLabel(day), show(v), ...(config.compare ? [vsNormal(v)] : [])] }];
        })}
      />
    </>
  );
}

// ---------------------------------------------------------------- VO2 max and fitness age

async function FitnessDetail({ supabase, athlete, today, days }: Ctx) {
  const all = windowDays(today, days);
  const since = addDays(all[0], -(VO2_WINDOW - 1));
  const [rides, measurements, apple] = await Promise.all([
    loadRides(supabase, new Date(`${since}T00:00:00Z`)),
    loadBodyMeasurements(supabase, new Date(`${addDays(since, -60)}T00:00:00Z`)),
    supabase.from("health_days").select("day, vo2max").not("vo2max", "is", null).gte("day", all[0]).lte("day", today).order("day"),
  ]);
  if (apple.error) console.error(apple.error);
  const tz = athlete.timezone;
  // Each ride's best 5 minutes at the weight you were then (the latest weigh-in on or before it).
  const efforts = rides.flatMap((r) => {
    const watts = r.powerCurve?.[300];
    if (!watts) return [];
    const day = localDate(r.startedAt, tz);
    const weight = measurements.findLast((m) => localDate(m.measuredAt, tz) <= day)?.weightKg ?? athlete.weightKg;
    const vo2 = weight ? vo2maxFromPower(watts, weight) : null;
    return [{ ride: r, day, watts, weight, vo2 }];
  });
  const vo2Points = efforts.flatMap((e) => (e.vo2 !== null ? [{ day: e.day, value: e.vo2 }] : []));
  const appleByDay = new Map((apple.data ?? []).map((r) => [r.day, Number(r.vo2max)]));
  const vo2Series = (w: string[]) => rollingBest(vo2Points, w, VO2_WINDOW);
  const wattSeries = (w: string[]) => w.map((day) => Math.max(0, ...efforts.filter((e) => e.day === day).map((e) => e.watts)) || null);
  const window = all.slice(dataStart([wattSeries(all), all.map((d) => appleByDay.get(d) ?? null)], Math.min(30, days)));
  const vo2 = vo2Series(window);
  const watts = wattSeries(window);
  const appleSeries = window.map((d) => appleByDay.get(d) ?? null);

  // Headline numbers as the Progress page has them: best 5 minutes of the last 90 days at today's weight.
  const recent = efforts.filter((e) => e.day > addDays(today, -VO2_WINDOW));
  const best = recent.length ? Math.max(...recent.map((e) => e.watts)) : null;
  const weight = measurements.at(-1)?.weightKg ?? athlete.weightKg;
  const latestApple = [...appleByDay].at(-1) ?? null;
  const current = best && weight ? vo2maxFromPower(best, weight) : (latestApple?.[1] ?? null);
  const age = athlete.birthDate ? ageOn(athlete.birthDate, today) : null;
  const sex = athlete.sex;
  const fAge = current !== null && sex ? fitnessAge(current, sex) : null;
  const rating = current !== null && age !== null && sex ? vo2maxRating(current, age, sex) : null;
  const bands = age !== null && sex ? vo2maxBands(age, sex) : null;
  const bandIndex = bands && current !== null ? bands.findLastIndex((b) => current >= b.from) : -1;
  const vo2Stats = seriesStats(vo2);
  const inRange = efforts.filter((e) => e.day >= window[0]).sort((a, b) => b.ride.startedAt.getTime() - a.ride.startedAt.getTime());

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat lead label="VO2 max" value={current !== null ? current.toFixed(1) : <Dash />} unit={current !== null ? "ml/kg/min" : undefined} sub={rating ?? (current === null ? "Needs a ride with power and your weight" : undefined)} />
        <Stat label="Fitness age" value={fAge ?? <Dash />} unit={fAge !== null ? "years" : undefined} sub={age !== null ? `You're ${age}` : "Needs birth date and sex"} />
        <Stat label="Best 5 minutes" value={best !== null ? Math.round(best) : <Dash />} unit={best !== null ? "W" : undefined} sub={best !== null && weight ? `${(best / weight).toFixed(2)} W/kg · last ${VO2_WINDOW} days` : `Last ${VO2_WINDOW} days`} />
        <Stat label="Apple Watch" value={latestApple ? latestApple[1].toFixed(1) : <Dash />} unit={latestApple ? "ml/kg/min" : undefined} sub={latestApple ? dayLabel(latestApple[0]) : "No Cardio Fitness reading"} />
      </StatStrip>
      <ChartPanel title="VO2 max" meta={`Best of the ${VO2_WINDOW} days before each day`}>
        <TrendChart label="VO2 max by day" days={window} values={vo2} unit="ml/kg/min" decimals={1} bridge normal={age !== null && sex ? averageVo2max(age, sex) : null} normalLabel="Average for your age" height={CHART_HEIGHT} />
        {vo2Stats.change !== null && (
          <p className="mt-3 text-sm text-muted">
            <span className="num">{signedFixed(vo2Stats.change)}</span> over {periodLabel(window)}.
          </p>
        )}
      </ChartPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartPanel title="Best 5 minutes by ride day" meta="W">
          <TrendChart label="Best 5-minute power by day" days={window} values={watts} unit="W" bridge />
        </ChartPanel>
        <Panel title="Where you sit" meta={age !== null && sex ? `${sex === "male" ? "Men" : "Women"} aged ${age}` : undefined}>
          {bands ? (
            <ol className="space-y-1.5 text-sm">
              {[...bands].reverse().map((b, ri) => {
                const i = bands.length - 1 - ri;
                const to = bands[i + 1]?.from;
                const mine = i === bandIndex;
                return (
                  <li key={b.label} className={`flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 ${mine ? "bg-raised font-medium" : ""}`}>
                    <span>
                      {b.label}
                      {mine && <span className="ml-2 text-xs font-normal text-muted">You</span>}
                    </span>
                    <span className="num text-muted">{i === 0 ? `under ${to}` : to ? `${b.from} to ${to}` : `${b.from}+`}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-sm text-muted">Add your birth date and sex in Settings to compare with your age.</p>
          )}
        </Panel>
      </div>
      {appleSeries.some((v) => v !== null) && (
        <ChartPanel title="Apple Watch Cardio Fitness" meta="ml/kg/min">
          <TrendChart label="Apple Watch VO2 max by day" days={window} values={appleSeries} unit="ml/kg/min" decimals={1} bridge />
        </ChartPanel>
      )}
      <DayTable
        title="Rides"
        noun="ride"
        empty="No rides with power in this range."
        columns={[{ label: "Day" }, { label: "Ride", wide: true }, { label: "5 min" }, { label: "W/kg", wide: true }, { label: "VO2 max" }]}
        rows={inRange.map((e) => ({
          key: e.ride.id,
          cells: [
            <Link key="d" href={`/rides/${e.ride.id}`} className="underline-offset-4 hover:underline">
              {dayLabel(e.day)}
            </Link>,
            <span key="n" className="inline-block max-w-56 truncate align-bottom text-muted">{e.ride.name ?? "Ride"}</span>,
            fixed(e.watts, 0, "W"),
            e.weight ? (e.watts / e.weight).toFixed(2) : null,
            e.vo2 !== null ? e.vo2.toFixed(1) : null,
          ],
        }))}
      />
    </>
  );
}

// ---------------------------------------------------------------- body

async function BodyDetail({ supabase, athlete, today, days }: Ctx) {
  const tz = athlete.timezone;
  const all = windowDays(today, days);
  const measurements = await loadBodyMeasurements(supabase, new Date(`${addDays(all[0], -1)}T00:00:00Z`));
  const on = (day: string) => weighInOn(measurements, day, tz);
  const weightsOf = (w: string[]) => w.map((d) => on(d)?.weightKg ?? null);
  const window = all.slice(dataStart([weightsOf(all)], Math.min(30, days)));
  const weights = weightsOf(window);
  const fat = window.map((d) => on(d)?.bodyFatPercent ?? null);
  const lean = window.map((d) => on(d)?.fatFreeMassKg ?? null);
  const w = seriesStats(weights);
  const f = seriesStats(fat);
  const l = seriesStats(lean);
  const shown = measurements.filter((m) => localDate(m.measuredAt, tz) >= window[0]).reverse();

  return (
    <>
      <StatStrip cols={4} phone={2}>
        <Stat lead label="Weight" value={w.latest !== null ? w.latest.toFixed(1) : <Dash />} unit={w.latest !== null ? "kg" : undefined} sub={w.latestIndex !== null ? dayLabel(window[w.latestIndex]) : "No weigh-ins yet"} />
        <Stat label="Change" value={w.change !== null ? signedFixed(w.change) : <Dash />} unit={w.change !== null ? "kg" : undefined} sub={w.change !== null ? `Since ${dayLabel(window[weights.findIndex((v) => v !== null)])}` : "Needs two weigh-ins"} />
        <Stat label="Body fat" value={f.latest !== null ? f.latest.toFixed(1) : <Dash />} unit={f.latest !== null ? "%" : undefined} sub={f.change !== null ? `${signedFixed(f.change)} pts in range` : undefined} />
        <Stat label="Lean mass" value={l.latest !== null ? l.latest.toFixed(1) : <Dash />} unit={l.latest !== null ? "kg" : undefined} sub={l.change !== null ? `${signedFixed(l.change)} kg in range` : undefined} />
      </StatStrip>
      <ChartPanel title="Weight" meta={periodLabel(window)}>
        <TrendChart label="Weight by day" days={window} values={weights} unit="kg" decimals={1} bridge normal={w.mean} normalLabel="Average" height={CHART_HEIGHT} />
      </ChartPanel>
      <div className="grid gap-4 md:grid-cols-2">
        <ChartPanel title="Body fat" meta="%">
          <TrendChart label="Body fat by day" days={window} values={fat} unit="%" decimals={1} bridge />
        </ChartPanel>
        <ChartPanel title="Lean mass" meta="kg">
          <TrendChart label="Lean mass by day" days={window} values={lean} unit="kg" decimals={1} bridge />
        </ChartPanel>
      </div>
      <Panel title="Weigh-ins" meta={shown.length ? `${shown.length} weigh-in${shown.length === 1 ? "" : "s"}` : undefined} className="min-w-0">
        <WeighInTable measurements={shown} timeZone={tz} />
      </Panel>
    </>
  );
}
