// The demo ride screen: the simulated trainer rides a short workout in ERG, with the numbers and
// chart a real ride shows, and a cadence slider to feel that the watts hold. Nothing is saved.

import { useEffect, useRef, useState } from "react";
import { button } from "@/components/ui";
import { intervalAt, targetWattsAt, workoutDuration, type Segment } from "@/lib/engine/workout";
import WorkoutChart, { type TracePoint } from "@/app/ride/workout-chart";
import { simBackend, simRider } from "~/bluetooth/sim";
import { createClient } from "~/db/supabase-client";
import { connectDemoGear, DEMO_WORKOUT, type DemoGear, type DemoReading } from "./demo";

const TOTAL = workoutDuration(DEMO_WORKOUT);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function caption(segment: Segment | undefined, index: number, watts: number | null) {
  if (!segment) return "";
  const w = watts ? `${watts} W` : "the target";
  if (index === 0) return `Warm-up. Lactic nudges the trainer up a little every second, to ${w} now. You just pedal.`;
  if (index === DEMO_WORKOUT.segments.length - 1) return "Easy to finish. The trainer lets off by itself.";
  if (segment.kind === "steady" && segment.target >= 1) return `Effort. The trainer holds ${w}. Spin faster or slower with the slider: the watts stay put, it's only the resistance that changes.`;
  return `Recovery at ${w}. No shifting: Lactic changes the resistance for you.`;
}

export function DemoRide({ onClose }: { onClose: (finished: boolean) => void }) {
  const [ftp, setFtp] = useState<number | null>(null);
  const [reading, setReading] = useState<DemoReading>({ watts: null, heartRate: null, cadence: null });
  const [elapsed, setElapsedState] = useState(0);
  const elapsedRef = useRef(0);
  const setElapsed = (t: number) => {
    elapsedRef.current = t;
    setElapsedState(t);
  };
  const [running, setRunning] = useState(false);
  const [cadence, setCadence] = useState(90);
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gear = useRef<DemoGear | null>(null);
  const latest = useRef(reading);
  latest.current = reading;

  // The rider's FTP, or a typical one if setup skipped it.
  useEffect(() => {
    void createClient()
      .from("athlete_settings")
      .select("ftp_watts")
      .maybeSingle()
      .then(({ data }) => setFtp(Number(data?.ftp_watts) || 200));
  }, []);

  // Connect the simulator's trainer and strap; give back the simulated rider as it was.
  useEffect(() => {
    const saved = { ...simRider };
    simRider.pedaling = true;
    let alive = true;
    void connectDemoGear(simBackend(), (r) => alive && setReading((prev) => ({ ...prev, ...r })))
      .then((g) => {
        if (!alive) return void g.stop();
        gear.current = g;
        setRunning(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      Object.assign(simRider, saved);
      void gear.current?.stop();
      gear.current = null;
    };
  }, []);

  useEffect(() => {
    simRider.cadence = cadence;
  }, [cadence]);

  // The workout clock: one second at a time, sending the trainer each new target.
  useEffect(() => {
    if (!running || ftp === null) return;
    const tick = setInterval(() => {
      const t = elapsedRef.current;
      const r = latest.current;
      setTrace((tr) => [...tr, [t, r.watts ?? 0, r.heartRate ?? 0, r.cadence ?? 0]]);
      setElapsed(Math.min(t + 1, TOTAL));
      if (t + 1 >= TOTAL) setRunning(false);
    }, 1000);
    return () => clearInterval(tick);
  }, [running, ftp]);

  const target = ftp === null ? null : targetWattsAt(DEMO_WORKOUT, Math.min(elapsed, TOTAL - 1), ftp);
  useEffect(() => {
    if (running && target !== null) void gear.current?.setTarget(target);
  }, [running, target]);

  const done = elapsed >= TOTAL;
  const interval = intervalAt(DEMO_WORKOUT, Math.min(elapsed, TOTAL - 1));
  const left = interval ? interval.end - elapsed : 0;

  const restart = () => {
    setTrace([]);
    setElapsed(0);
    setRunning(true);
  };
  const skip = () => {
    if (interval) setElapsed(Math.min(interval.end, TOTAL));
  };

  return (
    <div className="theme-dark fixed inset-0 z-[70] flex flex-col bg-ground text-ink" role="dialog" aria-modal="true" aria-label="Demo ride">
      <header className="lactic-titlebar flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-5">
        <p className="text-sm">
          <span className="font-medium">Demo ride</span>
          <span className="text-muted"> · simulated trainer and heart rate, not saved</span>
        </p>
        <button type="button" className={button.ghost} onClick={() => onClose(false)}>
          Back to the tour
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-y-auto px-5 py-6">
        {error ? (
          <p className="text-negative">The simulator didn&apos;t start: {error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
              <Metric label="Power" value={reading.watts} unit="W" sub={target !== null && !done ? `Target ${target} W` : undefined} />
              <Metric label="Heart rate" value={reading.heartRate} unit="bpm" />
              <Metric label="Cadence" value={reading.cadence === null ? null : Math.round(reading.cadence)} unit="rpm" />
              <Metric label={done ? "Ridden" : "Interval left"} value={done ? clock(TOTAL) : clock(left)} sub={done ? undefined : `${clock(elapsed)} of ${clock(TOTAL)}`} />
            </div>

            <div className="rounded-xl border border-line bg-surface p-4">
              {ftp !== null && <WorkoutChart workout={DEMO_WORKOUT} ftp={ftp} position={elapsed} trace={trace} to={TOTAL} className="h-40 w-full" />}
            </div>

            <p className="min-h-12 max-w-2xl text-pretty text-muted" aria-live="polite">
              {done
                ? "That's a workout. On a real ride Lactic saves it to Progress, sends it to intervals.icu if you've connected it, and updates your fitness and plan."
                : running
                  ? caption(interval?.segment, interval?.index ?? 0, target)
                  : "Connecting the simulated trainer…"}
            </p>

            {!done && (
              <label className="block max-w-md space-y-2">
                <span className="flex justify-between text-sm">
                  <span>Your cadence</span>
                  <span className="num text-muted">{cadence} rpm</span>
                </span>
                <input type="range" min={60} max={115} value={cadence} onChange={(e) => setCadence(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
              </label>
            )}
          </>
        )}
      </div>

      <footer className="shrink-0 border-t border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-4">
          {done ? (
            <button type="button" className={button.secondary} onClick={restart}>
              Ride it again
            </button>
          ) : (
            <button type="button" className={button.secondary} disabled={!running} onClick={skip}>
              Skip to next interval
            </button>
          )}
          <button type="button" className={button.primary} onClick={() => onClose(true)}>
            {done ? "Finish the tour" : "End and finish the tour"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function Metric({ label, value, unit, sub }: { label: string; value: number | string | null; unit?: string; sub?: string }) {
  return (
    <div className="bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 text-4xl font-semibold tracking-tight">
        {value ?? "–"}
        {unit && value !== null && <span className="ml-1 text-base font-normal text-muted">{unit}</span>}
      </p>
      <p className="num mt-1 h-5 text-sm text-faint">{sub}</p>
    </div>
  );
}
