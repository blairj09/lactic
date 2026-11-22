// The website demo's ride page extras, for a ride the visitor rode in this tab: Post to Strava (the
// same post-then-disconnect relay as the try-a-ride page, ../try/strava.ts) and a nudge to keep riding
// with the download. Nothing is kept: the demo's database lives in this tab.

import { useEffect, useState } from "react";
import type { Workout } from "@shared/engine/workout";
import { postRide, signIn, STRAVA_ORANGE, stravaClientId } from "~/try/strava";
import { countTestDrive } from "~/try/count";
import { rideFit } from "~/data/export";
import { sql } from "~/db/sql";
import { remembered } from "@shared/ble/devices";
import { button } from "@/components/ui";
import { isDemo } from "./flag";
import { SIM_TRAINER, lastDemoRide } from "./gear";
import { handoffScheme, handoffUrl, type Handoff } from "~/try/handoff";

interface Recorded {
  name: string;
  startedAt: string;
  workout: Workout;
  simulated: boolean;
}

const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

async function recorded(id: string): Promise<Recorded | null> {
  const [ride] = (await sql().select("select name, started_at, source from activities where id = ?", [id])) as { name: string; started_at: string; source: string }[];
  if (!ride || ride.source !== "app") return null;
  const [stream] = (await sql().select("select workout from activity_streams where activity_id = ?", [id])) as { workout: unknown }[];
  const workout = json(stream?.workout) as Workout | null;
  return { name: ride.name, startedAt: ride.started_at, workout: workout ?? ({ name: ride.name, segments: [] } as unknown as Workout), simulated: lastTrainer() === SIM_TRAINER };
}

/** Which trainer rode last in this tab. */
const lastTrainer = () => remembered("trainer")?.deviceName ?? null;

/** Asks the homepage around the demo to start the download for this computer. */
export function askDownload() {
  try {
    window.parent.postMessage({ lactic: "download" }, location.origin);
  } catch {
    // Not in the homepage: nothing to ask.
  }
}

type Posting = { at: "idle" | "signing" | "posting" } | { at: "posted"; activityId: string | null } | { at: "failed"; message: string };

export function DemoStravaButton({ id }: { id: string }) {
  const [ride, setRide] = useState<Recorded | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [posting, setPosting] = useState<Posting>({ at: "idle" });

  useEffect(() => {
    if (!isDemo) return;
    void recorded(id).then(setRide).catch(() => setRide(null));
    void stravaClientId().then(setClientId);
  }, [id]);

  if (!isDemo || !ride || !clientId) return null;

  const post = async () => {
    setPosting({ at: "signing" });
    try {
      const code = await signIn(clientId);
      setPosting({ at: "posting" });
      const file = await rideFit(id);
      if (!file) throw new Error("This ride has no recorded samples to post.");
      setPosting({ at: "posted", activityId: await postRide(code, ride, file.bytes) });
      countTestDrive("posted-strava", ride.simulated);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPosting(message === "closed" ? { at: "idle" } : { at: "failed", message });
    }
  };

  if (posting.at === "posted")
    return (
      <a className="text-sm font-medium hover:underline" style={{ color: STRAVA_ORANGE }} href={posting.activityId ? `https://www.strava.com/activities/${posting.activityId}` : "https://www.strava.com/dashboard"} target="_blank" rel="noreferrer">
        Posted. View on Strava
      </a>
    );
  const busy = posting.at === "signing" || posting.at === "posting";
  return (
    <span className="flex items-center gap-2">
      {posting.at === "failed" && <span className="text-sm text-negative">{posting.message}</span>}
      <button type="button" onClick={() => void post()} disabled={busy} className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-semibold whitespace-nowrap text-white hover:opacity-90 disabled:opacity-80" style={{ backgroundColor: STRAVA_ORANGE }}>
        {posting.at === "signing" ? "Signing in…" : posting.at === "posting" ? "Posting…" : "Post to Strava"}
      </button>
    </span>
  );
}

/** The app's link scheme: the homepage's ?app=preview opens the Preview build. */
function scheme(): string {
  try {
    return handoffScheme(window.parent.location.search);
  } catch {
    return handoffScheme(location.search);
  }
}

/**
 * "Great start." on the page of a ride ridden in this tab. Download free starts the homepage's
 * download, then the card turns into "Open Lactic": a lactic:// link carrying the FTP and, unless the
 * ride was simulated, the ride itself (../try/handoff.ts), so the app starts where the visitor left off.
 */
export function DemoKeepRiding({ id }: { id: string }) {
  const [handoff, setHandoff] = useState<{ url: string; ftp: number; ride: string | null; simulated: boolean } | null>(null);
  const [show, setShow] = useState(true);
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!isDemo) return;
    void (async () => {
      const r = await recorded(id);
      const note = lastDemoRide();
      if (!r || !note) return;
      const file = note.simulated ? null : await rideFit(id);
      const h: Handoff = { ftp: note.ftp, method: note.method, ride: file ? { name: r.name, fit: file.bytes } : null };
      setHandoff({ url: handoffUrl(h, scheme()), ftp: h.ftp, ride: h.ride ? r.name : null, simulated: note.simulated });
    })().catch(() => undefined);
  }, [id]);
  if (!handoff || !show) return null;
  const carries = handoff.ride ? `Your FTP (${handoff.ftp} W) and this ride come with you.` : `Your FTP (${handoff.ftp} W) comes with you.`;
  const open = (
    <a href={handoff.url} onClick={() => countTestDrive("opened-app", handoff.simulated)} className={downloaded ? `${button.primary} h-10 px-4` : "font-medium text-ink underline underline-offset-4"}>
      {downloaded ? "Open Lactic" : "Open it"}
    </a>
  );
  return (
    <aside aria-label="Keep riding" className="fixed right-4 bottom-4 z-40 w-[min(380px,calc(100vw-2rem))] space-y-3 rounded-xl border border-line bg-surface p-5 shadow-xl">
      {downloaded ? (
        <>
          <h2 className="text-lg font-semibold">Lactic is downloading</h2>
          <p className="text-[15px] text-muted">Install it, then open it from here. {carries}</p>
          <div className="flex gap-2">
            {open}
            <button type="button" className={`${button.secondary} h-10 px-4`} onClick={() => setShow(false)}>
              Keep exploring
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">Great start.</h2>
          <p className="text-[15px] text-muted">Keep riding with the free Lactic download. It saves every ride and builds your plan around them.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${button.primary} h-10 px-4`}
              onClick={() => {
                askDownload();
                setDownloaded(true);
              }}
            >
              Download free
            </button>
            <button type="button" className={`${button.secondary} h-10 px-4`} onClick={() => setShow(false)}>
              Keep exploring
            </button>
          </div>
          <p className="text-sm text-muted">
            {carries} Already have Lactic? {open}
          </p>
        </>
      )}
    </aside>
  );
}
