import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Nav from "@/components/nav";
import { Page, PageHeader } from "@/components/ui";
import { authEnabled } from "@/lib/supabase/config";
import { isMetric, metricHref, METRICS, rangeFrom } from "../metrics";
import MetricDetail from "./metric-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ metric: string }> }) {
  const { metric } = await params;
  return { title: `${isMetric(metric) ? METRICS[metric].title : "Health"} · My Coach` };
}

/** A Health metric as its own page: what a reload or a shared link opens. From the Health page it opens as a sheet. */
export default async function MetricPage({ params, searchParams }: { params: Promise<{ metric: string }>; searchParams: Promise<{ days?: string | string[] }> }) {
  const { metric } = await params;
  if (!isMetric(metric)) notFound();
  const days = rangeFrom((await searchParams).days);
  // VO2 max moved to Progress; old links follow it.
  if (metric === "fitness") redirect(metricHref(metric, days));
  return (
    <>
      <Nav current="/health" />
      <Page>
        <Link href="/health" className="inline-flex items-center gap-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          ← Health
        </Link>
        {authEnabled ? <MetricDetail metric={metric} days={days} /> : <PageHeader title={METRICS[metric].title} line="Health needs Supabase." />}
      </Page>
    </>
  );
}
