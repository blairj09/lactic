import { notFound, redirect } from "next/navigation";
import Sheet from "@/components/sheet";
import { authEnabled } from "@/lib/supabase/config";
import MetricDetail from "../../../health/[metric]/metric-detail";
import { isMetric, metricHref, rangeFrom } from "../../../health/metrics";

export const dynamic = "force-dynamic";

/** A Health tile followed inside the app opens its closer look over the Health page; reloading opens the full page. */
export default async function MetricSheet({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<{ days?: string | string[] }> }) {
  const { metric } = await params;
  if (!isMetric(metric) || !authEnabled) notFound();
  const days = rangeFrom((await searchParams).days);
  if (metric === "fitness") redirect(metricHref(metric, days));
  return (
    <Sheet width="medium">
      <MetricDetail metric={metric} days={days} inSheet />
    </Sheet>
  );
}
