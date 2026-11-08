import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/nav";
import { Notice, Page, PageHeader, Panel } from "@/components/ui";
import { loadAthlete, loadRide } from "@/lib/activities";
import { coachModel } from "@/lib/coach/conversation";
import { raceReport, type RaceReport } from "@/lib/engine/race/report";
import { isTimed } from "@/lib/engine/race/track";
import { formatDay } from "@/lib/format";
import { loadRaceData } from "@/lib/race";
import { createClient } from "@/lib/supabase/server";
import RaceReview from "./race-review";
import RaceSetup from "./race-setup";

export const metadata = { title: "Race report · Lactic" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * A race, taken apart: your ride lined up against other riders' GPX files (and your own best lap),
 * lap by lap and section by section, with where the time went, what to work on and the coach's debrief.
 */
export default async function RaceReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [ride, data, athlete] = await Promise.all([loadRide(supabase, id), loadRaceData(supabase, id), loadAthlete(supabase)]);
  if (!ride) notFound();

  let report: RaceReport | null = null;
  let problem: string | null = null;
  if (data.ownTrack) {
    try {
      report = raceReport({ own: data.ownTrack, ownName: data.ownName, rivals: data.rivals, results: data.results });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  const ready = report !== null;

  return (
    <>
      <Nav current="/progress" />
      <Page>
        <PageHeader
          title={ride.name ?? "Race report"}
          line={
            <>
              Race report · {formatDay(ride.startedAt, athlete.timezone)}
              {report ? ` · ${report.lapCount} laps of ${(report.lapMeters / 1000).toFixed(2)} km` : ""}
            </>
          }
          actions={
            <Link href={`/rides/${id}`} className="text-sm text-muted hover:text-ink">
              Back to the ride
            </Link>
          }
        />
        {problem && <Notice>{problem}</Notice>}
        {report && <RaceReview activityId={id} report={report} notes={data.notes} debrief={data.debrief} coachOn={Boolean(coachModel())} />}
        <div id="race-files" className="scroll-mt-20">
        <Panel title={ready ? "Files and results" : "Set up the report"} meta={ready ? undefined : "Three steps, about a minute"}>
          <RaceSetup
            activityId={id}
            ownPoints={data.ownTrack?.points.length ?? null}
            canFetch={Boolean(data.intervalsId)}
            rivals={data.rivals.map((r) => ({ id: r.id, name: r.name, points: r.track.points.length, timed: isTimed(r.track) }))}
            resultsText={data.resultsText}
            results={data.results}
            ownName={data.ownName}
          />
        </Panel>
        </div>
      </Page>
    </>
  );
}
