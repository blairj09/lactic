"use client";

import { button as ui } from "@/components/ui";
import { input } from "@/components/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { AskCoach } from "@/app/coach/ask-coach";
import type { StravaMissing } from "@/lib/intervals/client";
import { connectIntervals, disconnectIntervals, pushIntervalsPlan, setIntervalsUpload, syncIntervals } from "../actions";

export interface IntervalsStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  historyDone: boolean;
  /** Local start time the history import has reached back to. */
  historyReachedBack: string | null;
  /** Rides recorded here go to intervals.icu. */
  uploadRides: boolean;
  /** Rides that came to intervals.icu from Strava and aren't here. */
  stravaMissing: StravaMissing | null;
}

const monthYear = (date: string) => new Date(date).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** Strava doesn't let intervals.icu share the rides it got from Strava: say what's missing and how to bring it in. */
function StravaGap({ missing }: { missing: StravaMissing }) {
  const n = missing.count;
  const span = missing.oldest && missing.newest ? (monthYear(missing.oldest) === monthYear(missing.newest) ? ` (${monthYear(missing.oldest)})` : ` (${monthYear(missing.oldest)} to ${monthYear(missing.newest)})`) : "";
  return (
    <div role="status" className="space-y-1.5 rounded-lg border border-line bg-raised p-3 text-sm">
      <p className="font-medium">
        {n} ride{n === 1 ? "" : "s"} from Strava {n === 1 ? "isn't" : "aren't"} in Lactic{span}.
      </p>
      <p className="text-muted">
        intervals.icu got {n === 1 ? "this ride" : "these rides"} from Strava, and Strava doesn't let it share them with other apps. Until they&apos;re here,
        your fitness and plan leave them out, so the plan may start you too easy.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        <li>
          <span className="text-ink">New rides:</span> in intervals.icu → Settings, connect your Garmin, Wahoo, COROS, Polar, Suunto or Zwift account directly (for
          a Karoo, turn on intervals.icu in the Hammerhead dashboard). Rides then reach Lactic with their data.
        </li>
        <li>
          <span className="text-ink">Past rides:</span> on strava.com, Settings → My Account → Download or Delete Your Account → Request your archive. Strava
          emails a .zip; choose it under Import FIT files below. Rides Strava only has as GPX or TCX files can&apos;t come in this way.
        </li>
      </ul>
    </div>
  );
}

export default function IntervalsPanel({ status }: { status: IntervalsStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [connectState, connect, connecting] = useActionState(connectIntervals, null);

  const run = async (mode: "new" | "history" | "reimport") => {
    setBusy(true);
    const log: string[] = [];
    setFailed(false);
    // Keep fetching batches until there's nothing more. A re-import restarts once, then continues as history.
    try {
      for (let next = mode; ; next = next === "reimport" ? "history" : next) {
        const result = await syncIntervals(next);
        log.push(result.message);
        setLines([...log]);
        if (!result.ok) setFailed(true);
        if (!result.ok || !result.more) break;
      }
    } catch {
      // The call itself failed (timed out, or the connection dropped). Progress up to the last batch is saved.
      log.push("The import stopped partway. Press the button again to carry on from where it got to.");
      setLines([...log]);
      setFailed(true);
    }
    setBusy(false);
    router.refresh();
  };

  const button = ui.secondary;
  const reachedBack = status.historyReachedBack?.startsWith("9999") ? null : status.historyReachedBack;

  return (
    <div className="space-y-2">
      {!status.connected ? (
        <form action={connect} className="space-y-2">
          <p className="text-sm text-muted">
            In intervals.icu, Settings → Developer Settings → generate an API key, then paste it here.
          </p>
          <span className="flex flex-wrap gap-2">
            <input
              name="api_key"
              type="password"
              autoComplete="off"
              placeholder="API key"
              className={`${input} w-64 max-w-full`}
            />
            <button disabled={connecting} className={ui.primary}>
              {connecting ? "Checking..." : "Connect"}
            </button>
          </span>
          {connectState && !connectState.ok && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-negative">{connectState.message}</p>
              <AskCoach prompt={`I can't connect intervals.icu. It said: "${connectState.message}" Can you help?`} />
            </div>
          )}
        </form>
      ) : (
        <>
          <p className="text-sm text-muted">
            Connected.{" "}
            {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. ` : ""}
            {status.historyDone
              ? "History imported."
              : reachedBack
                ? `History imported back to ${new Date(reachedBack.slice(0, 10)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}.`
                : "History not imported yet."}{" "}
            Each sync puts your next 4 weeks on its calendar.
          </p>
          {status.stravaMissing && status.stravaMissing.count > 0 && <StravaGap missing={status.stravaMissing} />}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              defaultChecked={status.uploadRides}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                setLines([(await setIntervalsUpload(e.target.checked)).message]);
                setBusy(false);
              }}
            />
            <span>
              Send Lactic rides to intervals.icu
              <span className="block text-muted">
                Skipped if Zwift or your bike computer already sent it.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={() => run("new")}>
              Sync new rides
            </button>
            {!status.historyDone ? (
              <button className={button} disabled={busy} onClick={() => run("history")}>
                Import the last 2 years
              </button>
            ) : (
              <button
                className={button}
                disabled={busy}
                title="Reads every ride's file again, to fill in power distribution for rides imported before it was kept."
                onClick={() => run("reimport")}
              >
                Re-import the last 2 years
              </button>
            )}
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setLines([(await pushIntervalsPlan()).message]);
                setBusy(false);
              }}
            >
              Send plan to calendar
            </button>
            <button
              className={button}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setLines([(await disconnectIntervals()).message]);
                setBusy(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      )}
      {busy && <p className="text-sm text-muted">Working... a big history import takes a few minutes.</p>}
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {failed && !busy && <AskCoach prompt={`intervals.icu sync isn't working. It said: "${lines.at(-1) ?? ""}" Can you check what's wrong?`} />}
    </div>
  );
}
