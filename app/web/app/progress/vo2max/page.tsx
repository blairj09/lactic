import Link from "next/link";
import Nav from "@/components/nav";
import { Page } from "@/components/ui";
import { METRICS, rangeFrom } from "../../health/metrics";
import MetricDetail from "../../health/[metric]/metric-detail";

export const metadata = {
  title: `${METRICS.fitness.title} · My Coach`,
};
export const dynamic = "force-dynamic";

/** VO2 max and fitness age up close, as its own page: what a reload or a shared link opens. From Progress it opens as a sheet. */
export default async function Vo2maxPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = rangeFrom((await searchParams).days);
  return (
    <>
      <Nav current="/progress" />
      <Page>
        <Link
          href="/progress"
          className="inline-flex items-center gap-1 text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Progress
        </Link>
        <MetricDetail metric="fitness" days={days} />
      </Page>
    </>
  );
}
