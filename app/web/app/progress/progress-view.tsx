"use client";

import Link from "next/link";
import { useState } from "react";
import FitnessChart from "@/components/fitness-chart";
import PowerCurveChart from "@/components/power-curve-chart";
import PowerDistributionChart from "@/components/power-distribution-chart";
import PowerProfile from "@/components/power-profile";
import RangePicker, { formatRange } from "@/components/range-picker";
import { hoursMinutes } from "@/components/chart-utils";
import { clampRange, compareRange, inRange, presetRange, summarizeRange, type CompareMode, type DateRange } from "@/lib/engine/analysis";
import type { AnalysisData } from "@/lib/analysis-data";
import { PageHeader, Panel } from "@/components/ui";

const DATE = /^\d{4}-\d\d-\d\d$/;

/**
 * One date range (and optionally a second to compare) scopes every chart on the page. The range
 * lives in the URL, so a view can be bookmarked and the back button doesn't lose it.
 */
export default function ProgressView({
  data,
  initial,
  fitness,
  levels,
  review,
  tabs,
}: {
  data: AnalysisData;
  initial: { from?: string; to?: string; compare?: string };
  /** VO2 max and fitness age now; shown after the power profile, which it comes from. */
  fitness?: React.ReactNode;
  /** Progression levels, which are where you are now rather than over the range; shown beside the power profile. */
  levels?: React.ReactNode;
  /** The coach's review of last week, once written; a fixed week, so above the range picker. */
  review?: React.ReactNode;
  /** The Trends / Rides switch, under the header. */
  tabs?: React.ReactNode;
}) {
  const { today, earliest } = data;
  const bounds = { from: earliest, to: today };
  const [range, setRangeState] = useState<DateRange>(() =>
    initial.from && initial.to && DATE.test(initial.from) && DATE.test(initial.to)
      ? clampRange({ from: initial.from, to: initial.to }, bounds)
      : presetRange("3m", today, earliest),
  );
  const [compare, setCompareState] = useState<CompareMode | null>(
    initial.compare === "previous" || initial.compare === "lastYear" ? initial.compare : null,
  );

  const remember = (r: DateRange, c: CompareMode | null) => {
    const params = new URLSearchParams({ from: r.from, to: r.to, ...(c ? { compare: c } : {}) });
    window.history.replaceState(null, "", `?${params}`);
  };
  const setRange = (r: DateRange) => {
    const next = clampRange(r, bounds);
    setRangeState(next);
    remember(next, compare);
  };
  const setCompare = (c: CompareMode | null) => {
    setCompareState(c);
    remember(range, c);
  };

  const current = summarizeRange(data.rides, range);
  const compared = compare ? summarizeRange(data.rides, compareRange(range, compare)) : null;
  const summaries = compared ? [current, compared] : [current];
  const labels = compared ? ["This range", compare === "previous" ? "Previous period" : "Last year"] : ["This range"];
  const days = data.days.filter((d) => inRange(d.date, range));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Progress"
        line={
          <>
            Fitness and power over time. Drag across a chart to zoom in. Recovery and sleep are on{" "}
            <Link href="/health" className="text-ink underline underline-offset-4">
              Health
            </Link>
            .
          </>
        }
      />

      {tabs}

      {review}

      <div className="sticky top-12 z-10 -mx-4 space-y-2 border-b border-line bg-ground px-4 py-3 sm:-mx-6 sm:px-6">
        <RangePicker range={range} onChange={setRange} today={today} earliest={earliest} compare={compare} onCompareChange={setCompare} />
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summaries.map((s, i) => (
          <Stat key={i} label={`${labels[i]} · ${formatRange(s.range)}`} value={`${s.rides} rides`} detail={hoursMinutes(s.seconds)} />
        ))}
      </section>

      {data.missingHistograms > 0 && (
        <p className="text-sm text-warning">
          {data.missingHistograms} ride{data.missingHistograms === 1 ? "" : "s"} {data.missingHistograms === 1 ? "has" : "have"} no power distribution
          yet. Re-import from intervals.icu in <Link href="/settings#connections" className="underline underline-offset-4">Settings</Link> to fill {data.missingHistograms === 1 ? "it" : "them"} in.
        </p>
      )}

      <Panel title="Fitness, fatigue and form" className="min-w-0">
        <FitnessChart days={days} label={formatRange(range)} onZoom={(from, to) => setRange({ from, to })} />
      </Panel>

      <Panel title="Power curve" className="min-w-0">
        <PowerCurveChart series={summaries.map((s, i) => ({ label: labels[i], curve: s.curve }))} />
      </Panel>

      <Panel title="Power profile" className="min-w-0">
        <PowerProfile series={summaries.map((s, i) => ({ label: labels[i], curve: s.curve }))} weightKg={data.weightKg} sex={data.sex} />
      </Panel>

      {fitness}

      {levels}

      <Panel title="Power distribution" className="min-w-0">
        <PowerDistributionChart series={summaries.map((s, i) => ({ label: labels[i], histogram: s.histogram, zones: s.zones }))} ftp={data.ftp} />
      </Panel>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num text-2xl font-medium tracking-tight">
        {value} <span className="text-sm font-normal text-muted">{detail}</span>
      </p>
    </div>
  );
}
