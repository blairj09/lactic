import Link from "next/link";
import { notFound } from "next/navigation";
import Nav from "@/components/nav";
import { ExperimentalTag } from "@/components/experimental-tag";
import { experiments } from "@/lib/experiments";
import { Notice, Page, PageHeader, Panel } from "@/components/ui";
import { loadAthlete, loadRide } from "@/lib/activities";
import { coachModel } from "@/lib/coach/conversation";
import { isTimed } from "@/lib/engine/race/track";
import { buildRace, type BuiltRace } from "@/lib/race-build";
import { formatDay } from "@/lib/format";
import { bestCurveBefore, loadRaceData } from "@/lib/race";
import { eventForRace, loadGlance } from "@/lib/race-glance";
import { GOAL_KIND_LABELS } from "@/lib/engine/plan";
import { createClient } from "@/lib/supabase/server";
import RaceGlance from "./glance";
import RaceReview from "./race-review";
import RaceSetup from "./race-setup";
import SoloReview from "./solo-review";

export const metadata = { title: "Race report · Lactic" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;
/** Events raced in laps, where your earlier rides can't line up as past editions. */
const LAP_KINDS = new Set(["criterium", "cyclocross", "track"]);

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
  if (!experiments().race_report) {
    return (
      <>
        <Nav current="/progress" />
        <Page>
          <PageHeader title={ride.name ?? "Race report"} line="Race report" />
          <Notice>
            Race reports are an experimental feature. Turn them on in{" "}
            <Link href="/settings" className="underline">
              Settings → Experimental features
            </Link>
            .
          </Notice>
        </Page>
      </>
    );
  }

  // The comparisons every report makes on its own, and the event this race was (from the plan).
  const [bestCurve, event] = await Promise.all([bestCurveBefore(supabase, ride.startedAt.toISOString()), eventForRace(supabase, ride, athlete).catch(() => null)]);
  const glance = await loadGlance(supabase, ride, athlete, data, bestCurve, event).catch((e) => (console.error(e), null));

  let built: BuiltRace | null = null;
  let problem: string | null = null;
  if (data.ownTrack) {
    try {
      built = buildRace({ ...data, ownTrack: data.ownTrack }, athlete, ride.startedAt, bestCurve);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  const report = built?.kind === "laps" ? built.report : null;
  const solo = built?.kind === "solo" ? built.report : null;
  const ready = built !== null;

  return (
    <>
      <Nav current="/progress" />
      <Page>
        <PageHeader
          title={event?.name ?? ride.name ?? "Race report"}
          line={
            <>
              <ExperimentalTag className="mr-2 align-[2px]" />
              Race report · {formatDay(ride.startedAt, athlete.timezone)}
              {report ? ` · ${report.lapCount} laps of ${(report.lapMeters / 1000).toFixed(2)} km` : ""}
              {solo ? " · one long race, read from your ride" : ""}
            </>
          }
          actions={
            <Link href={`/rides/${id}`} className="text-sm text-muted hover:text-ink">
              Back to the ride
            </Link>
          }
        />
        {problem && <Notice>{problem}</Notice>}
        {glance && (
          <RaceGlance
            activityId={id}
            glance={glance}
            event={event ? `${event.name} · ${GOAL_KIND_LABELS[event.kind].toLowerCase()}, ${event.priority} race` : null}
            solo={Boolean(solo) || (!report && Boolean(event && !LAP_KINDS.has(event.kind)))}
            pastNames={data.rivals.filter((r) => r.past).map((r) => r.name)}
            preRaceHref={event && glance.plan && experiments().course_prep ? `/plan/events/${event.id}` : null}
          />
        )}
        {report && <RaceReview activityId={id} report={report} notes={data.notes} debrief={data.debrief} coachOn={Boolean(coachModel())} />}
        {solo && <SoloReview activityId={id} report={solo} notes={data.notes} debrief={data.debrief} coachOn={Boolean(coachModel())} />}
        <div id="race-files" className="scroll-mt-20">
        <Panel title={ready ? (solo ? "Files and places" : "Files and results") : "Set up the report"} meta={ready ? undefined : "Three steps, about a minute"}>
          <RaceSetup
            activityId={id}
            ownPoints={data.ownTrack?.points.length ?? null}
            canFetch={Boolean(data.intervalsId)}
            rivals={data.rivals.map((r) => ({ id: r.id, name: r.name, points: r.track.points.length, timed: isTimed(r.track), past: r.past }))}
            solo={Boolean(solo)}
            placesText={data.placesText}
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
