import Nav from "@/components/nav";
import { loadAthlete } from "@/lib/activities";
import { loadDaytime } from "@/lib/daytime-data";
import { healthSummary } from "@/lib/health-summary";
import { loadBodyMeasurements } from "@/lib/body-data";
import { localDate } from "@/lib/engine/activity";
import { loadRecovery, loadRecoveryTrend } from "@/lib/recovery-data";
import { authEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { Page, PageHeader } from "@/components/ui";
import HealthView, { TREND_DAYS, WEIGHT_DAYS } from "./health-view";

export const metadata = { title: "Health · My Coach" };
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  if (!authEnabled) {
    return (
      <>
        <Nav current="/health" />
        <Page>
          <PageHeader title="Health" line="Recovery and weigh-ins need Supabase." />
        </Page>
      </>
    );
  }
  const supabase = await createClient();
  const athlete = await loadAthlete(supabase);
  const tz = athlete.timezone;
  const today = localDate(new Date(), tz);
  const daytimeLoad = loadDaytime(supabase, athlete, today).catch((e) => (console.error(e), null));
  const [daytime, measurementsOldestFirst, recovery, trend] = await Promise.all([
    daytimeLoad,
    loadBodyMeasurements(supabase, new Date(Date.now() - WEIGHT_DAYS * 86_400_000)),
    loadRecovery(supabase, today, athlete.sleepNeedHours, daytimeLoad),
    loadRecoveryTrend(supabase, today, athlete.sleepNeedHours, TREND_DAYS, daytimeLoad),
  ]);
  const summary = healthSummary({
    athlete,
    today,
    daytime,
    trend: trend.days,
    nights: trend.nights,
    recovery: recovery.score?.score ?? null,
  });
  return (
    <HealthView
      athlete={athlete}
      today={today}
      measurements={measurementsOldestFirst}
      recovery={recovery}
      trend={trend}
      summary={summary}
      hasWatch={daytime?.hasWatch ?? false}
    />
  );
}
