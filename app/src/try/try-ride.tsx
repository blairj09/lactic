// The website's try-a-ride page (lactic.fit/ride/): set an FTP and connect a trainer (or the
// simulated one), pick a half-hour workout, ride it on Lactic's own ride screen, then see how it
// went and where the app goes from there. Nothing is saved or sent: the ride lives in this tab until
// the visitor saves its .fit file.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MemoryRouter } from "react-router";
import { SensorHub, isWebBluetoothAvailable } from "@shared/ble/sensor-hub";
import { isPickerCancel, DEVICE_KEYS, forgetDevice, rememberDevice, remembered } from "@shared/ble/devices";
import { rideStressFromSummary, summarizeRide } from "@shared/engine/activity";
import { rampTestFtp } from "@shared/engine/ftp";
import { STARTING_LEVELS } from "@shared/engine/library";
import { workoutDuration } from "@shared/engine/workout";
import { encodeRideFit } from "@shared/fit/encode";
import { Notice, Panel, Stat, StatStrip, button, input } from "@/components/ui";
import RideScreen, { type FinishedRide } from "@/app/ride/ride-screen";
import WorkoutChart from "@/app/ride/workout-chart";
import { formatTime } from "@/app/ride/player";
import { Wordmark } from "~/app/brand";
import { DEFAULT_TRY_FTP, DEFAULT_TRY_WORKOUT, TRY_TAGS, readFtp, tryWorkouts } from "./workouts";

type Step = "setup" | "pick" | "ride" | "done";

const STEPS: [Step, string][] = [
  ["setup", "Set up"],
  ["pick", "Workout"],
  ["ride", "Ride"],
];

export default function TryRideApp() {
  return (
    <MemoryRouter>
      <TryRide />
    </MemoryRouter>
  );
}

function TryRide() {
  const [step, setStep] = useState<Step>("setup");
  const [ftpText, setFtpText] = useState(String(DEFAULT_TRY_FTP));
  const [simulated, setSimulated] = useState(false);
  const [hub, setHub] = useState<SensorHub | null>(null);
  const [workoutId, setWorkoutId] = useState(DEFAULT_TRY_WORKOUT);
  const [finished, setFinished] = useState<FinishedRide | null>(null);
  const ftp = readFtp(ftpText) ?? DEFAULT_TRY_FTP;

  useEffect(() => {
    document.title = "Ride a workout in your browser · Lactic";
    window.scrollTo({ top: 0 });
  }, [step]);

  const header = <TryHeader step={step} />;

  if (step === "setup" || !hub)
    return (
      <Shell header={header}>
        <SetUp
          ftpText={ftpText}
          onFtp={setFtpText}
          onReady={(next, sim) => {
            setHub(next);
            setSimulated(sim);
            setStep("pick");
          }}
        />
      </Shell>
    );
  if (step === "pick")
    return (
      <Shell header={header}>
        <Pick hub={hub} ftp={ftp} simulated={simulated} chosen={workoutId} onChoose={setWorkoutId} onBack={() => setStep("setup")} onStart={() => setStep("ride")} />
      </Shell>
    );
  if (step === "ride" || !finished)
    return (
      <RideScreen
        initialFtp={ftp}
        canSave={false}
        levels={STARTING_LEVELS}
        initialWorkout={`library:${workoutId}`}
        hub={hub}
        header={header}
        onFinished={(ride) => {
          setFinished(ride);
          setStep("done");
        }}
      />
    );
  return (
    <Shell header={header}>
      <Done ride={finished} onAgain={() => setStep("pick")} />
    </Shell>
  );
}

function Shell({ header, children }: { header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ground">
      {header}
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-6 pb-20 sm:px-6 sm:pt-10">{children}</main>
    </div>
  );
}

function TryHeader({ step }: { step: Step }) {
  const at = STEPS.findIndex(([s]) => s === step);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ground">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" aria-label="Lactic home">
          <Wordmark />
        </a>
        {step !== "done" && (
          <ol className="num hidden items-center gap-2 text-sm text-muted sm:flex" aria-label="Steps">
            {STEPS.map(([s, label], i) => (
              <li key={s} className={i === at ? "font-medium text-accent" : undefined} aria-current={i === at ? "step" : undefined}>
                {i > 0 && <span className="mr-2 text-faint">·</span>}
                {i + 1} {label}
              </li>
            ))}
          </ol>
        )}
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="size-2 rounded-full bg-positive" />
          <span className="max-sm:hidden">Nothing leaves this browser.</span>
          <span className="sm:hidden">Stays on this device</span>
        </p>
      </div>
    </header>
  );
}

// --- 1. Set up -----------------------------------------------------------------------------------

function SetUp({ ftpText, onFtp, onReady }: { ftpText: string; onFtp: (t: string) => void; onReady: (hub: SensorHub, simulated: boolean) => void }) {
  const bluetooth = useMemo(() => isWebBluetoothAvailable(), []);
  const [radioOff, setRadioOff] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ftpOk = readFtp(ftpText) !== null;

  useEffect(() => {
    if (!bluetooth) return;
    navigator.bluetooth
      .getAvailability?.()
      .then((on) => setRadioOff(!on))
      .catch(() => undefined);
  }, [bluetooth]);

  const connect = async () => {
    setError(null);
    // A simulated trainer from an earlier visit (or the homepage demo) isn't the visitor's gear.
    for (const key of DEVICE_KEYS) if (remembered(key)?.id.startsWith("sim:")) await forgetDevice(key);
    const hub = new SensorHub();
    setConnecting(true);
    try {
      // From the click, as Chrome needs for its picker.
      await hub.connect("trainer", { choose: true });
      onReady(hub, false);
    } catch (e) {
      if (!isPickerCancel(e)) setError(`Couldn't connect the trainer. ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(false);
    }
  };

  const simulate = async () => {
    setError(null);
    // The simulated trainer and heart rate strap are Lactic's own, speaking the real Bluetooth
    // formats, so the ride screen runs exactly as it does with real gear.
    const { installWebBluetooth, grant } = await import("~/bluetooth/web-bluetooth");
    await installWebBluetooth();
    for (const key of DEVICE_KEYS) await forgetDevice(key);
    rememberDevice("trainer", grant("sim:trainer", "Lactic Sim Trainer"));
    rememberDevice("heartRate", grant("sim:hr", "Lactic Sim HR"));
    onReady(new SensorHub(), true);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="num text-sm text-accent">Try a ride in your browser</p>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-[42px] sm:leading-[1.1]">Connect your trainer. Ride a 30-minute workout.</h1>
          <p className="max-w-xl text-[17px] text-muted">The same workout player as the Lactic app, ERG and all. No download, no sign-up.</p>
        </div>

        {!bluetooth && (
          <Notice>
            This browser can&apos;t connect to Bluetooth trainers. Open <span className="font-medium">lactic.fit/ride</span> in Chrome or Edge on a computer or Android phone, or try a simulated ride here.
          </Notice>
        )}
        {bluetooth && radioOff && <Notice>Bluetooth looks off on this computer. Turn it on, then connect your trainer.</Notice>}
        {error && <Notice tone="negative">{error}</Notice>}

        <Panel>
          <label className="block space-y-2">
            <span className="text-[15px] font-medium">Your FTP</span>
            <span className="flex items-center gap-3">
              <input className={`${input} num h-12 w-28 text-xl`} inputMode="numeric" value={ftpText} onChange={(e) => onFtp(e.target.value)} aria-invalid={!ftpOk} />
              <span className="text-muted">watts</span>
            </span>
            <span className="block text-sm text-muted">{ftpOk ? `Not sure? Leave ${DEFAULT_TRY_FTP}, or pick the ramp test next to find it.` : "Enter watts between 50 and 600."}</span>
          </label>
        </Panel>

        <div className="flex flex-wrap gap-3">
          {bluetooth && (
            <button className={`${button.primary} h-11 px-5 text-[15px]`} disabled={!ftpOk || connecting} onClick={connect}>
              {connecting ? "Connecting..." : "Connect trainer"}
            </button>
          )}
          <button className={`${bluetooth ? button.secondary : button.primary} h-11 px-5 text-[15px]`} disabled={!ftpOk || connecting} onClick={simulate}>
            {bluetooth ? "No trainer? Try a simulated ride" : "Try a simulated ride"}
          </button>
        </div>
      </div>

      <Panel className="h-fit space-y-5">
        <div className="space-y-2">
          <h2 className="font-medium">What you need</h2>
          <ul className="space-y-1.5 text-[15px] text-muted">
            <Check>A smart trainer: Wahoo, Tacx, Elite, Saris and other trainers with ERG.</Check>
            <Check>
              Chrome or Edge on a computer or Android phone.{bluetooth && <span className="font-medium text-positive"> You&apos;re set.</span>}
            </Check>
            <Check>Optional: a heart rate strap.</Check>
          </ul>
        </div>
        <div className="space-y-2 border-t border-line pt-5">
          <h2 className="font-medium">Your ride stays with you</h2>
          <p className="text-[15px] text-muted">The ride runs in this tab. Nothing is uploaded and there&apos;s no account. Save the .fit file at the end if you want to keep it.</p>
        </div>
        <p className="border-t border-line pt-5 text-[15px] text-muted">Riding with Zwift open? Lactic holds ERG; Zwift just reads your power.</p>
      </Panel>
    </div>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="font-semibold text-positive">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

// --- 2. Pick a workout ---------------------------------------------------------------------------

function Pick({
  hub,
  ftp,
  simulated,
  chosen,
  onChoose,
  onBack,
  onStart,
}: {
  hub: SensorHub;
  ftp: number;
  simulated: boolean;
  chosen: string;
  onChoose: (id: string) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const state = useSyncExternalStore(hub.subscribe, hub.getState, hub.getState);
  const list = useMemo(() => tryWorkouts(), []);
  const [error, setError] = useState<string | null>(null);
  const picked = list.find((w) => w.id === chosen) ?? list[0];
  const trainer = state.links.trainer;
  const hr = state.links.heartRate;

  const addHr = async () => {
    setError(null);
    try {
      await hub.connect("heartRate", { choose: true });
    } catch (e) {
      if (!isPickerCancel(e)) setError(`Couldn't connect the strap. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Pick a workout</h1>
          <p className="text-[15px] text-muted">Targets are set from your FTP of {ftp} W. Lactic sets the trainer for you.</p>
        </div>
        <p className="text-sm text-muted">
          {simulated ? "Simulated trainer" : trainer.status === "connected" ? `${trainer.name ?? "Trainer"} connected` : "Trainer not connected yet"}
          {" · "}
          <button className={button.ghost} onClick={onBack}>
            Change
          </button>
        </p>
      </div>
      {error && <Notice tone="negative">{error}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Workouts">
        {list.map((w) => {
          const on = w.id === picked.id;
          return (
            <button
              key={w.id}
              role="radio"
              aria-checked={on}
              onClick={() => onChoose(w.id)}
              className={`flex flex-col gap-1.5 rounded-lg border bg-surface p-4 text-left transition-colors hover:bg-raised ${on ? "border-accent outline-2 outline-accent" : "border-line"}`}
            >
              <span className="num self-start rounded bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-accent uppercase">{TRY_TAGS[w.id as keyof typeof TRY_TAGS]}</span>
              <span className="text-[17px] font-medium">{w.workout.name}</span>
              <span className="num text-sm text-muted">
                {w.id === "test-ramp" ? "Until you can't hold it" : `${formatTime(w.duration)} · TSS ${Math.round(w.stress)}`}
              </span>
              <span className="min-h-10 text-sm text-muted">{w.description}</span>
              <WorkoutChart workout={w.workout} ftp={ftp} position={0} trace={[]} to={workoutDuration(w.workout)} className="mt-1 h-14 w-full text-ink" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted">
          {simulated ? (
            "The simulated rider holds every target, so you can watch the whole thing play out."
          ) : hr.status === "connected" ? (
            `${hr.name ?? "Heart rate strap"} connected`
          ) : (
            <>
              Heart rate strap?{" "}
              <button className="text-accent underline underline-offset-2" onClick={addHr}>
                Add it
              </button>
            </>
          )}
        </p>
        <button className={`${button.primary} h-11 px-5 text-[15px]`} onClick={onStart}>
          Start {picked.workout.name}
        </button>
      </div>
    </div>
  );
}

// --- 4. Done -------------------------------------------------------------------------------------

/** The installer for this visitor's computer, from the latest release (site/api/release.js). */
function downloadFor(): { label: string; href: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android|iPhone|iPad/i.test(ua)) return { label: "Get Lactic", href: "/#download" };
  if (/Mac/i.test(ua)) return { label: "Download for Mac", href: "/api/release?get=mac" };
  if (/Windows/i.test(ua)) return { label: "Download for Windows", href: "/api/release?get=windows" };
  return { label: "Download Lactic", href: "/#download" };
}

function saveFit(ride: FinishedRide) {
  const bytes = encodeRideFit({ startedAt: new Date(ride.startedAt), watts: ride.watts, heartRate: ride.heartRate, cadence: ride.cadence });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.ant.fit" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `lactic-${ride.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.fit`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Done({ ride, onAgain }: { ride: FinishedRide; onAgain: () => void }) {
  const summary = useMemo(
    () => summarizeRide({ watts: ride.watts, heartRate: ride.heartRate, cadence: ride.cadence, hasPower: ride.watts.some((w) => w > 0), hasHeartRate: ride.heartRate.some((h) => h > 0) }),
    [ride],
  );
  const stress = rideStressFromSummary(summary, ride.ftp, null);
  const ramp = ride.rampTest ? rampTestFtp(ride.watts) : null;
  const download = downloadFor();

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <p className="num text-sm text-positive">Ride done</p>
          <h1 className="text-3xl font-semibold tracking-tight">{ride.name}</h1>
        </div>
        {ramp && (
          <Panel>
            <p className="text-sm text-muted">Your FTP from the ramp test</p>
            <p className="num text-[32px] font-medium tracking-tight">
              {ramp.watts}
              <span className="ml-1 text-sm font-normal text-muted">W</span>
            </p>
            <p className="text-sm text-muted">75% of your best minute, {ramp.bestMinute} W.</p>
          </Panel>
        )}
        <StatStrip cols={4} phone={2}>
          <Stat label="Time" value={formatTime(summary.durationSeconds)} />
          <Stat label="Avg power" value={summary.averagePower === null ? null : Math.round(summary.averagePower)} unit="W" />
          <Stat label="Normalized" value={summary.normalizedPower === null ? null : Math.round(summary.normalizedPower)} unit="W" />
          <Stat label="TSS" value={stress ? Math.round(stress.trainingStress) : null} />
        </StatStrip>
        <Panel>
          <WorkoutChart workout={ride.workout} ftp={ride.ftp} position={ride.trace.at(-1)?.[0] ?? 0} trace={ride.trace} to={Math.max(workoutDuration(ride.workout), ride.trace.length)} className="h-40 w-full text-ink" />
        </Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button className={button.secondary} onClick={() => saveFit(ride)}>
            Save .fit file
          </button>
          <span className="text-sm text-muted">Upload it to Strava, or bring it into Lactic later.</span>
        </div>
        <button className={button.ghost} onClick={onAgain}>
          Ride another workout
        </button>
      </div>

      <section className="h-fit space-y-6 rounded-xl bg-[#0d1117] p-6 text-white sm:p-8">
        <h2 className="text-[28px] leading-tight font-semibold tracking-tight text-balance">The Lactic app does this, and so much more.</h2>
        <ul className="space-y-3 text-[15px] text-[#b4bac5]">
          <li>
            <b className="font-medium text-white">A plan</b> that fits your week and adapts to how you feel
          </li>
          <li>
            <b className="font-medium text-white">A library of workouts</b> plus your own, and a coach that knows your numbers
          </li>
          <li>
            <b className="font-medium text-white">An overlay</b> that floats over Zwift, a video or anything else
          </li>
          <li>
            <b className="font-medium text-white">Progress, sleep and recovery</b> from your watch
          </li>
        </ul>
        <p className="text-[15px] text-[#b4bac5]">Free and open source. Your rides live on your computer, not on our servers.</p>
        <div className="flex flex-wrap gap-3">
          <a href={download.href} className="inline-flex h-11 items-center rounded-md bg-[#2b55d6] px-5 text-[15px] font-medium text-white hover:bg-[#1d3fa8]">
            {download.label}
          </a>
          <a href="/" className="inline-flex h-11 items-center rounded-md border border-[#333a46] px-5 text-[15px] font-medium text-white hover:bg-white/5">
            See everything it does
          </a>
        </div>
      </section>
    </div>
  );
}
