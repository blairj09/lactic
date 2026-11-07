import { notFound } from "next/navigation";
import Sheet from "@/components/sheet";
import { authEnabled } from "@/lib/supabase/config";
import MetricDetail from "../../../health/[metric]/metric-detail";
import { rangeFrom } from "../../../health/metrics";

export const dynamic = "force-dynamic";

/** The VO2 max stats on Progress open their closer look over the page; reloading opens the full page. */
export default async function Vo2maxSheet({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  if (!authEnabled) notFound();
  const days = rangeFrom((await searchParams).days);
  return (
    <Sheet width="medium">
      <MetricDetail metric="fitness" days={days} inSheet />
    </Sheet>
  );
}
