import Nav from "@/components/nav";
import AutoSync from "@/components/auto-sync";
import { Page, PageHeader } from "@/components/ui";
import { localDate } from "@/lib/engine/activity";
import { estimateFtp } from "@/lib/engine/ftp";
import { addDays } from "@/lib/engine/pmc";
import { mergeCurves } from "@/lib/engine/power";
import { loadBodyMeasurements, weighInOn } from "@/lib/body-data";
import { loadAthlete, loadStream, loadWatts } from "@/lib/activities";
import { rideShape } from "@/lib/engine/week-glance";
import { loadTrainingState } from "@/lib/training";
import { briefInputs, briefStale } from "@/lib/coach/chat";
import { loadBrief, loadReview } from "@/lib/coach/store";
import { reviewTime } from "@/lib/engine/review";
import { weekStart } from "@/lib/engine/plan";
import { loadConnection as loadIntervals } from "@/lib/intervals/client";
import { createClient } from "@/lib/supabase/server";
import { loadIngestToken } from "@/lib/recovery-data";
import { loadRecoverySetup, recoverySourceInfo } from "@/lib/recovery-source";
import TodayView, { ridesOn } from "../today";
import { experiments } from "@/lib/experiments";
import { loadRaceFollowUp, RACE_PROMPTS_SETTING } from "@/lib/race-glance";
import { getSetting } from "~/settings/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const coachEnabled = Boolean(process.env.OPENROUTER_API_KEY);
const FTP_WINDOW_DAYS = 90;

export default async function Today() {

  const supabase = await createClient();
  // The brief and last week's review only need today's date, so they load alongside the training state rather than
  // after it (loadAthlete is shared with loadTrainingState, so this costs no extra query).
  const dated = loadAthlete(supabase).then((a) => {
    const day = localDate(new Date(), a.timezone);
    const mon = weekStart(day);
    return Promise.all([
      day,
      coachEnabled ? optional(loadBrief(supabase, day)) : null,
      coachEnabled && reviewTime(day, mon) ? optional(loadReview(supabase, addDays(mon, -7))) : null,
    ] as const);
  });
  dated.catch(() => {}); // Reported by loadTrainingState, which loads the same athlete.
  const [state, icu, body, healthToken, recoverySetup, [briefDay, earlyBrief, earlyReview]] = await Promise.all([
    loadTrainingState(supabase),
    optional(loadIntervals(supabase)),
    optional(loadBodyMeasurements(supabase, new Date(Date.now() - 40 * 86_400_000))),
    optional(loadIngestToken(supabase)),
    loadRecoverySetup(),
    dated,
  ]);
  const { athlete, rides, today } = state;
  const monday = weekStart(today);
  const ridden = ridesOn(state, today);
  // Past midnight between the two clocks, the date-keyed loads are redone for the state's day.
  const sameDay = briefDay === today;
  // Each ridden day this week, by its main ride, for the ride's shape in This week.
  const weekRides = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    .filter((d) => d <= today)
    .flatMap((d) => {
      const r = ridesOn(state, d);
      return r ? [[d, r.main.id] as const] : [];
    });
  const [brief, reviewMessage, todayStream, raceFollowUp, weekWatts] = await Promise.all([
    sameDay ? earlyBrief : coachEnabled ? optional(loadBrief(supabase, today)) : null,
    sameDay ? earlyReview : coachEnabled && reviewTime(today, monday) ? optional(loadReview(supabase, addDays(monday, -7))) : null,
    ridden ? optional(loadStream(supabase, ridden.main.id)) : null,
    experiments().race_report
      ? optional(getSetting<{ dismissed?: string[] }>(RACE_PROMPTS_SETTING, {}).then((s) => loadRaceFollowUp(supabase, state, s.dismissed ?? [])))
      : null,
    loadWatts(supabase, weekRides.map(([, id]) => id)),
  ]);
  const rideShapes = Object.fromEntries(weekRides.flatMap(([d, id]) => (weekWatts.get(id) ? [[d, rideShape(weekWatts.get(id)!)]] : [])));
  const review = Boolean(reviewMessage?.meta.review);
  const due = (c: { lastSyncedAt: Date | null } | null) => Boolean(c && (!c.lastSyncedAt || Date.now() - c.lastSyncedAt.getTime() > 30 * 60_000));
  const syncDue: "intervals"[] = due(icu) ? ["intervals"] : [];

  const recoverySource = recoverySourceInfo(recoverySetup, Boolean(icu));

  const ftpSince = addDays(today, -FTP_WINDOW_DAYS);
  const recentCurves = rides.filter((r) => r.powerCurve && localDate(r.startedAt, athlete.timezone) >= ftpSince).map((r) => r.powerCurve!);
  const estimate = recentCurves.length ? estimateFtp(mergeCurves(...recentCurves)) : null;

  return (
    <>
      <Nav current="/" />
      <Page>
        {syncDue.length > 0 && <AutoSync services={syncDue} />}
        <TodayView state={state} body={body} estimate={estimate} ftpWindowDays={FTP_WINDOW_DAYS} coachEnabled={coachEnabled}
          healthLinked={Boolean(healthToken?.lastUsedAt) || Boolean(recoverySource?.connected)}
          recoverySource={recoverySource}
          review={review}
          rideShapes={rideShapes}
          todayStream={todayStream}
          raceFollowUp={raceFollowUp}
          intervalsConnected={Boolean(icu)}
          brief={
            coachEnabled
              ? { message: brief, stale: briefStale(brief, briefInputs(state, Boolean(body && weighInOn(body, today, athlete.timezone)))) }
              : null
          }
        />
      </Page>
    </>
  );
}

/** A card's data that failed to load (a slow or briefly unavailable database) shouldn't take down the whole page. */
async function optional<T>(load: Promise<T>): Promise<T | null> {
  try {
    return await load;
  } catch (e) {
    console.error(e);
    return null;
  }
}
