import Link from "next/link";
import Nav from "@/components/nav";
import RideCalendar from "@/components/ride-calendar";
import { Page, PageHeader, Panel } from "@/components/ui";
import { loadAthlete, loadRides } from "@/lib/activities";
import { localDate } from "@/lib/engine/activity";
import { loadCalendarRides } from "@/lib/ride-calendar-data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "History · My Coach" };
export const dynamic = "force-dynamic";

/** Every ride, as a month calendar or a list, with search and filters. Trends over time are on Progress. */
export default async function HistoryPage() {
  const supabase = await createClient();
  const [athlete, rides] = await Promise.all([loadAthlete(supabase), loadRides(supabase, undefined, { includeCopies: true })]);
  const counted = rides.filter((r) => !r.duplicateOf).length;
  const calendar = await loadCalendarRides(supabase, rides, athlete.timezone);
  return (
    <>
      <Nav current="/history" />
      <Page>
        <div className="space-y-6">
          <PageHeader
            title="History"
            line={
              <>
                {counted > 0 ? `${counted} ride${counted === 1 ? "" : "s"}. ` : ""}Open one for its charts and map. Fitness and power trends are on{" "}
                <Link href="/progress" className="text-ink underline underline-offset-4">
                  Progress
                </Link>
                .
              </>
            }
          />
          {rides.length > 0 ? (
            <Panel className="min-w-0">
              <RideCalendar rides={calendar} timeZone={athlete.timezone} today={localDate(new Date(), athlete.timezone)} />
            </Panel>
          ) : (
            <p className="text-sm text-muted">
              No rides yet. Connect intervals.icu or import FIT files in{" "}
              <Link href="/settings#connections" className="text-ink underline underline-offset-4">
                Settings
              </Link>{" "}
              to bring your history in.
            </p>
          )}
        </div>
      </Page>
    </>
  );
}
