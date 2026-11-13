// Settings → Connections → Strava: connect once, and rides recorded here post to Strava as Lactic
// activities. Shown while the "Post rides to Strava" experiment is on. A paired iPhone shows the
// computer's connection instead: the computer posts the rides recorded on the phone.

import { useEffect, useState } from "react";
import { button, Result } from "@/components/ui";
import { ExperimentalTag } from "@/components/experimental-tag";
import { Section } from "@/app/settings/settings-form";
import { useExperiments } from "@/lib/use-experiments";
import { isDesktop, isPhone, openExternal } from "~/platform/native";
import {
  connectStrava,
  disconnectStrava,
  loadStrava,
  recentStravaUploads,
  setStravaUploads,
  stravaActivityUrl,
  stravaClientId,
  stravaPoster,
  STRAVA_ORANGE,
  type StravaConnection,
  type StravaUpload,
} from "~/integrations/strava";
import { syncNow } from "~/integrations/background";

const STATUS: Record<StravaUpload["status"], string> = {
  pending: "Waiting to go",
  sending: "Sending",
  processing: "Strava is processing it",
  sent: "Posted",
  skipped: "Skipped",
  failed: "Couldn't post",
};

export function StravaSection() {
  const { strava_upload } = useExperiments();
  if (!strava_upload) return null;
  return (
    <Section
      id="strava"
      title={
        <>
          Strava <ExperimentalTag className="ml-1 align-[2px]" />
        </>
      }
      description="Posts rides you record here to your Strava as Lactic activities, with the workout and how each interval went."
    >
      <div className="sm:col-span-2">
        <StravaPanel />
      </div>
    </Section>
  );
}

export function StravaPanel() {
  const [connection, setConnection] = useState<StravaConnection | null | undefined>(undefined);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [poster, setPoster] = useState<Awaited<ReturnType<typeof stravaPoster>> | null>(null);
  const [uploads, setUploads] = useState<StravaUpload[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const reload = async () => {
    const c = await loadStrava();
    setConnection(c);
    setUploads(c ? await recentStravaUploads() : []);
  };

  useEffect(() => {
    void reload();
    void stravaPoster().then(setPoster);
    void stravaClientId().then((id) => setAvailable(id !== null));
  }, []);

  async function connect() {
    setBusy(true);
    setResult({ ok: true, message: isPhone() ? "Sign in to Strava and choose Authorize." : "Finish in your browser: sign in to Strava and choose Authorize." });
    try {
      const c = await connectStrava();
      setConnection(c);
      setResult({ ok: true, message: `Connected${c.athleteName ? ` as ${c.athleteName}` : ""}. Your next ride goes to Strava when you save it.` });
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectStrava();
      setResult({ ok: true, message: "Disconnected. Rides already on Strava stay there." });
      await reload();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    const r = await syncNow("strava");
    if (r) setResult(r);
    await reload();
    setBusy(false);
  }

  if (!isDesktop) return <p className="text-sm text-muted">Strava connects in the desktop app.</p>;
  if (connection === undefined || poster === null) return null;
  if (poster === "nowhere") return <p className="text-sm text-muted">Strava connects in Lactic on your computer for now.</p>;
  const viaComputer = poster === "computer";

  const connectButton = (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={busy || available === false}
      className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: STRAVA_ORANGE }}
    >
      Connect with Strava
    </button>
  );

  if (!connection && viaComputer)
    return (
      <p className="text-sm text-muted">
        Connect Strava in Lactic on your computer. Your computer then posts the rides you record on this iPhone too, once they sync, so none goes twice.
      </p>
    );

  if (!connection)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Each ride you record in Lactic shows on Strava as a Lactic activity: the workout&apos;s name as the title, and how each interval went, your
          normalized power, TSS and heart rate in the description. Lactic only asks Strava for permission to upload; it can&apos;t read your Strava.
        </p>
        {connectButton}
        {available === false && <p className="text-muted">Strava isn&apos;t switched on for Lactic yet, or lactic.fit can&apos;t be reached right now.</p>}
        {result && <Result ok={result.ok}>{result.message}</Result>}
      </div>
    );

  return (
    <div className="space-y-4 text-sm">
      <p>
        {viaComputer ? "Connected on your computer" : "Connected"}
        {connection.athleteName ? ` as ${connection.athleteName}` : ""}.
        {viaComputer && <span className="text-muted"> It posts the rides you record on this iPhone once they sync, so none goes twice.</span>}
      </p>
      {connection.needsReconnect && (
        <div role="alert" className="space-y-2 rounded-lg border border-line bg-raised p-3">
          <p className="font-medium">Strava signed Lactic out.</p>
          <p className="text-muted">
            {viaComputer ? "Connect Strava again in Lactic on your computer, and the rides waiting will go." : "Connect again and the rides waiting will go."}
          </p>
          {!viaComputer && connectButton}
        </div>
      )}
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={connection.uploadRides}
          onChange={async (e) => {
            const on = e.target.checked;
            setConnection({ ...connection, uploadRides: on });
            await setStravaUploads(on);
          }}
        />
        <span>
          <span className="block font-medium">Post rides recorded here</span>
          <span className="text-muted">
            If Zwift or another app also sends your rides to Strava, turn its Strava upload off, or each ride shows up twice.
          </span>
        </span>
      </label>
      {uploads.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-medium">Recent rides</p>
          <ul className="space-y-1">
            {uploads.map((u) => (
              <li key={u.activityId} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="truncate">{u.name ?? "Ride"}</span>
                <span className="text-muted">
                  {u.stravaId ? (
                    <a className="underline underline-offset-4 hover:text-ink" href={stravaActivityUrl(u.stravaId)} onClick={(e) => (e.preventDefault(), void openExternal(stravaActivityUrl(u.stravaId!)))}>
                      {STATUS[u.status]} · View on Strava
                    </a>
                  ) : (
                    <>
                      {STATUS[u.status]}
                      {u.error && u.status !== "sent" ? `: ${u.error}` : ""}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!viaComputer && (
        <div className="flex flex-wrap gap-2">
          {uploads.some((u) => u.status === "pending" || u.status === "processing") && (
            <button type="button" className={button.secondary} onClick={() => void retry()} disabled={busy}>
              Send now
            </button>
          )}
          <button type="button" className={button.ghost} onClick={() => void disconnect()} disabled={busy}>
            Disconnect Strava
          </button>
        </div>
      )}
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </div>
  );
}
