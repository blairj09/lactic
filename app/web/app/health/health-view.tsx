import Link from "next/link";
import Nav from "@/components/nav";
import { StageBars } from "@/components/sleep-charts";
import TrendChart from "@/components/trend-chart";
import type { Athlete } from "@/lib/activities";
import { weighInOn, type BodyMeasurement } from "@/lib/body-data";
import ProvenanceTag from "@/components/provenance";
import { weightProvenance } from "@/lib/engine/provenance";
import { localDate } from "@/lib/engine/activity";
import { ageOn, bodyTrend } from "@/lib/engine/body";
import { addDays } from "@/lib/engine/pmc";
import { type RecoveryNormals, type RecoveryTrendDay } from "@/lib/engine/recovery";
import { formatDay, signedFixed } from "@/lib/format";
import type { HealthSummary } from "@/lib/health-summary";
import type { RecoveryToday, SleepDetail, SleepNightRow, StageNight } from "@/lib/recovery-data";
import { Dash, Notice, Page, PageHeader, Panel, SectionTitle, Stat, StatStrip } from "@/components/ui";
import WeighIn from "./weigh-in";
import LastNight from "../last-night";
import { ALL_FEATURES, type Features } from "@/lib/features";
import { metricHref } from "./metrics";
import { ExertionPanel, hoursMinutes, LinkPanel, WeighInTable } from "./parts";
import { formatWeight, readUnits, tempDeltaIn, temperatureUnit, weightIn, weightUnit } from "@/lib/units";

export const TREND_DAYS = 30;
export const WEIGHT_DAYS = 90;

/** The Health screen: last night from Apple Health, 30-day trends, and the scale. `measurements` oldest first. */
export default function HealthView({
  athlete,
  today,
  measurements: measurementsOldestFirst,
  recovery,
  trend,
  summary,
  hasWatch,
  tracking = ALL_FEATURES,
}: {
  athlete: Athlete;
  today: string;
  measurements: BodyMeasurement[];
  recovery: RecoveryToday;
  trend: { days: RecoveryTrendDay[]; normals: RecoveryNormals; stages: StageNight[]; nights: SleepNightRow[] };
  summary: HealthSummary;
  /** Daytime heart rate has arrived from Apple Health at least once. */
  hasWatch: boolean;
  /** What the rider tracks: recovery and weight each show only when on. */
  tracking?: Features;
}) {
  const tz = athlete.timezone;
  const units = readUnits();
  const kg = (v: number) => weightIn(v, units);
  const recent = [...measurementsOldestFirst].reverse();
  const ready = athlete.heightCm !== null && athlete.sex !== null && athlete.birthDate !== null;

  const trendDays = Array.from({ length: TREND_DAYS }, (_, i) => addDays(today, i - (TREND_DAYS - 1)));
  const byDay = new Map(trend.days.map((d) => [d.day, d]));
  const series = (pick: (d: RecoveryTrendDay) => number | null) => trendDays.map((day) => (byDay.has(day) ? pick(byDay.get(day)!) : null));
  const nights = trend.days.filter((d) => d.hrv !== null || d.restingHeartRate !== null).length;
  const { normals } = trend;
  // Wrist temperature and breathing rate show only once some has arrived.
  const wristTemp = trend.days.some((d) => d.wristTempDeltaC !== null);
  const breathing = trend.days.some((d) => d.respiratoryRate !== null);
  const { exertion, sleep } = summary;
  const fromMap = (map: Map<string, number>) => trendDays.map((day) => map.get(day) ?? null);

  const weightDays = Array.from({ length: WEIGHT_DAYS }, (_, i) => addDays(today, i - (WEIGHT_DAYS - 1)));
  const weights = weightDays.map((day) => weighInOn(measurementsOldestFirst, day, tz)?.weightKg ?? null).map((v) => (v === null ? null : kg(v)));
  const latest = recent[0];
  const weightChange = bodyTrend(measurementsOldestFirst, new Date());

  const weightSource = latest ? <ProvenanceTag source={weightProvenance(latest.source, localDate(latest.measuredAt, tz))} today={today} /> : undefined;

  const hrvKind = recovery.today?.hrvKind === "sdnn" ? "SDNN" : "RMSSD";

  return (
    <>
      <Nav current="/health" />
      <Page>
        <PageHeader
          title="Health"
          line={
            <>
              {tracking.recovery && tracking.weight ? "Recovery, sleep and weight" : tracking.recovery ? "Recovery and sleep" : "Weight and body"}. Training fitness is on{" "}
              <Link href="/progress" className="text-ink underline underline-offset-4">
                Progress
              </Link>
              .
            </>
          }
        />

        {tracking.recovery && (
          <>
        {/* Last night's one home: Today shows a summary that links here. */}
        <section className="space-y-3">
          {recovery.today ? (
            <LastNight
              recovery={recovery}
              source={null}
              timeZone={tz}
              exertionUsual={exertion.normal?.mean ?? null}
              hrefs={{
                recovery: metricHref("recovery"),
                hrv: metricHref("hrv"),
                restingHeartRate: metricHref("resting-hr"),
                sleepHours: metricHref("sleep"),
                respiratoryRate: metricHref("breathing"),
                wristTemp: metricHref("wrist-temp"),
                exertion: metricHref("exertion"),
              }}
            />
          ) : (
            <Panel title="Recovery">
              <p className="text-sm text-muted">No night recorded yet.</p>
            </Panel>
          )}
          {recovery.sleep && <SleepLine sleep={recovery.sleep} timeZone={tz} />}
          {!hasWatch && (
            <Notice>Exertion counts rides only. Send daytime heart rate from Apple Health to count the whole day.</Notice>
          )}
        </section>

        {(hasWatch || exertion.yesterday) && (
          <section className="space-y-3">
            <SectionTitle>Yesterday</SectionTitle>
            <ExertionPanel exertion={exertion} activity={summary.activity} href={metricHref("exertion")} />
          </section>
        )}

        <section className="space-y-3">
          <SectionTitle meta={`Last ${TREND_DAYS} days · ${nights} night${nights === 1 ? "" : "s"} recorded`}>Trends</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <TrendPanel href={metricHref("recovery")} title="Recovery" note="50 is a normal day">
              <TrendChart label="Recovery score by day" days={trendDays} values={series((d) => d.score)} domain={[0, 100]} normal={50} normalLabel="A normal day" />
            </TrendPanel>
            <TrendPanel href={metricHref("exertion")} title="Exertion" note="0 to 10, the whole day">
              <TrendChart label="Exertion by day" days={trendDays} values={fromMap(exertion.byDay)} domain={[0, 10]} normal={exertion.normal?.mean ?? null} normalLabel="Your usual day" decimals={1} />
            </TrendPanel>
            <TrendPanel href={metricHref("sleep-score")} title="Sleep score" note="Out of 100">
              <TrendChart label="Sleep score by night" days={trendDays} values={fromMap(sleep.byDay)} domain={[0, 100]} />
            </TrendPanel>
            <TrendPanel href={metricHref("hrv")} title="HRV" note={`${hrvKind}, ms`}>
              <TrendChart label="HRV by night" days={trendDays} values={series((d) => d.hrv)} normal={normals.hrv} unit="ms" />
            </TrendPanel>
            <TrendPanel href={metricHref("resting-hr")} title="Resting HR" note="bpm">
              <TrendChart label="Resting heart rate by night" days={trendDays} values={series((d) => d.restingHeartRate)} normal={normals.restingHeartRate} unit="bpm" />
            </TrendPanel>
            <TrendPanel href={metricHref("sleep")} title="Sleep" note="Hours asleep">
              <TrendChart label="Hours asleep by night" days={trendDays} values={series((d) => d.sleepHours)} normal={athlete.sleepNeedHours} normalLabel="Your sleep need" unit="h" decimals={1} />
            </TrendPanel>
            {breathing && <TrendPanel href={metricHref("breathing")} title="Breathing rate" note="Breaths per minute asleep">
              <TrendChart label="Breathing rate by night" days={trendDays} values={series((d) => d.respiratoryRate)} normal={normals.respiratoryRate} unit="/min" decimals={1} />
            </TrendPanel>}
            {wristTemp && <TrendPanel href={metricHref("wrist-temp")} title="Wrist temp" note={`Against normal, ${temperatureUnit(units)}`}>
              <TrendChart label="Temperature change by night" days={trendDays} values={series((d) => (d.wristTempDeltaC === null ? null : tempDeltaIn(d.wristTempDeltaC, units)))} normal={0} unit={temperatureUnit(units)} decimals={1} signed />
            </TrendPanel>}
            {trend.stages.length > 0 && (
              <div className="md:col-span-2 lg:col-span-3">
                <TrendPanel href={metricHref("sleep")} title="Sleep stages" note="Hours by night">
                  <StageBars days={trendDays} nights={trend.stages} sleepNeedHours={athlete.sleepNeedHours} />
                </TrendPanel>
              </div>
            )}
            {tracking.weight && (
              <TrendPanel href={metricHref("body")} title="Weight" note={`Last ${WEIGHT_DAYS} days, ${weightUnit(units)}`}>
                <TrendChart label="Weight by day" days={weightDays} values={weights} unit={weightUnit(units)} decimals={1} bridge />
              </TrendPanel>
            )}
          </div>
        </section>

          </>
        )}

        {tracking.weight && (
        <section className="space-y-3">
          <SectionTitle>Body</SectionTitle>
          <StatStrip cols={3} phone={3}>
            <Stat
              label="Weight"
              href={metricHref("body")}
              source={weightSource}
              value={latest ? kg(latest.weightKg).toFixed(1) : <Dash />}
              unit={latest ? weightUnit(units) : undefined}
              sub={latest ? formatDay(latest.measuredAt, tz) : "No weigh-ins yet"}
            />
            <Stat
              label="Body fat"
              href={metricHref("body")}
              source={latest?.bodyFatPercent != null ? weightSource : undefined}
              value={latest?.bodyFatPercent != null ? latest.bodyFatPercent.toFixed(1) : <Dash />}
              unit={latest?.bodyFatPercent != null ? "%" : undefined}
              sub={latest?.fatFreeMassKg != null ? `${formatWeight(latest.fatFreeMassKg, units)} lean` : undefined}
            />
            <Stat
              label="30 days"
              href={metricHref("body")}
              value={weightChange.weightKg !== null ? signedFixed(kg(weightChange.weightKg)) : <Dash />}
              unit={weightChange.weightKg !== null ? weightUnit(units) : undefined}
              sub={
                weightChange.bodyFatPercent !== null
                  ? `${signedFixed(weightChange.bodyFatPercent)} pts fat`
                  : "Needs a month"
              }
            />
          </StatStrip>
          {/* Without recovery there's no Trends section, so the weight trend sits here. */}
          {!tracking.recovery && (
            <TrendPanel href={metricHref("body")} title="Weight" note={`Last ${WEIGHT_DAYS} days, ${weightUnit(units)}`}>
              <TrendChart label="Weight by day" days={weightDays} values={weights} unit={weightUnit(units)} decimals={1} bridge />
            </TrendPanel>
          )}
          <Panel>
            <WeighIn profile={ready ? { male: athlete.sex === "male", heightCm: athlete.heightCm!, age: ageOn(athlete.birthDate!, today) } : null} />
            {!ready && (
              <p className="mt-3 text-sm text-muted">
                Add your height, birth date and sex in{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings
                </Link>{" "}
                for body composition.
              </p>
            )}
          </Panel>
          <Panel title={`Last ${WEIGHT_DAYS} days`} meta={recent.length ? `${recent.length} weigh-in${recent.length === 1 ? "" : "s"}` : undefined} className="min-w-0">
              <WeighInTable measurements={recent} timeZone={tz} />
              <p className="mt-4 text-sm text-muted">Body fat is estimated (Sun et al., 2003) and moves with hydration, so watch the trend.</p>
            </Panel>
        </section>
        )}
      </Page>
    </>
  );
}




/** Last night's times and stages, as one quiet line under the stats. */
function SleepLine({ sleep, timeZone }: { sleep: SleepDetail; timeZone: string }) {
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const parts = [
    sleep.start && sleep.end && `Asleep ${time(sleep.start)} to ${time(sleep.end)}`,
    sleep.deepHours !== null && `Deep ${hoursMinutes(sleep.deepHours)}`,
    sleep.remHours !== null && `REM ${hoursMinutes(sleep.remHours)}`,
    sleep.coreHours !== null && `Core ${hoursMinutes(sleep.coreHours)}`,
    sleep.awakeHours !== null && `Awake ${hoursMinutes(sleep.awakeHours)}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="num text-sm text-muted">{parts.join(" · ")}</p>;
}

function TrendPanel({ title, note, href, children }: { title: string; note: string; href: string; children: React.ReactNode }) {
  return (
    <LinkPanel href={href} title={title} note={note}>
      {children}
    </LinkPanel>
  );
}

