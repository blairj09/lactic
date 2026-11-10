// The iPhone as a remote for a ride on the computer. While Lactic's Ride page is open on the paired
// computer, a bar above the tabs says so; tapping it opens the ride as the computer shows it, with
// its controls (start and pause, skip, intensity, ERG, extend, end). Presses go to the computer and
// run there, as if clicked on it. Asks every few seconds in the background, every second while open.
//
// The workout's end: a notification with Extend and End buttons. The phone hears nothing from the
// computer while it's locked, so each answer moves a notification scheduled for the end (Swift
// keeps it, and runs the buttons from the lock screen or a watch); paused or ended, it's dropped.
// Open at the end, the remote opens itself on the Extend panel.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlayerView, formatTime, type PlayerControls } from "@/app/ride/player";
import { Notice, button } from "@/components/ui";
import { isRiding } from "@/lib/live-ride";
import { endAlert, endAlertKey } from "@/lib/ride/end-alert";
import { sendableArgs, type ControlMessage, type ControlName, type OverlayPayload } from "~/ride/channel";
import { cancelRideEnd, phoneStatus, scheduleRideEnd, send } from "./plugin";

interface Reply {
  ride: OverlayPayload | null;
}

const OPEN_EVERY = 1000;
const CLOSED_EVERY = 5000;

const NAMES: ControlName[] = ["onPlayPause", "onSkip", "onBack", "onIntensity", "onErg", "onErgMode", "onGrade", "onExtend", "onEnd", "onExtendMinutes", "onExtendWatts", "onExtendKind", "onExtendBlock", "onHold"];

export function ComputerRide() {
  const [computer, setComputer] = useState<string | null>(null);
  const [ride, setRide] = useState<OverlayPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [lost, setLost] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const computerRef = useRef(computer);
  computerRef.current = computer;
  /** Set while a request is out, so polls and presses never overlap. */
  const asking = useRef(false);

  useEffect(() => {
    void phoneStatus()
      .then((s) => setComputer(s.paired?.computer ?? null))
      .catch(() => {});
  }, []);

  /** What Swift was last told about the ride-end notification, so it only hears about changes. */
  const lastAlert = useRef("");
  const ask = useCallback(async (control?: ControlMessage) => {
    try {
      const reply = await send<Reply>("ride", control ? { control } : {}, 5);
      setRide(reply.ride);
      setLost(false);
      syncEndAlert(reply.ride, computerRef.current, lastAlert);
    } catch {
      // Out of reach: keep the last view up while it's open, and say so; otherwise drop the bar.
      if (openRef.current) setLost(true);
      else setRide(null);
    }
  }, []);

  useEffect(() => {
    if (!computer) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop) return;
      if (!document.hidden && !asking.current && !isRiding()) {
        asking.current = true;
        await ask();
        asking.current = false;
      }
      if (!stop) timer = setTimeout(() => void loop(), openRef.current ? OPEN_EVERY : CLOSED_EVERY);
    };
    void loop();
    const wake = () => {
      if (document.hidden) return;
      clearTimeout(timer);
      void loop();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [computer, open, ask]);

  // Open at the workout's end (tapped from the notification, or just looking): show the Extend panel.
  const openedFor = useRef<string>("");
  useEffect(() => {
    const d = ride?.data;
    if (!d?.finished || d.ended) return;
    const key = endAlertKey(d.workout.name, d.duration);
    if (openedFor.current !== key) {
      openedFor.current = key;
      setOpen(true);
    }
  }, [ride]);

  // The computer's Ride page closed: nothing left to steer.
  useEffect(() => {
    if (!ride && !lost) setOpen(false);
  }, [ride, lost]);

  const controls = useMemo(
    () =>
      Object.fromEntries(
        NAMES.map((name) => [
          name,
          (...args: unknown[]) => {
            if (name === "onEnd" && !window.confirm("End the ride on your computer? It's saved there.")) return;
            asking.current = true;
            void ask({ name, args: sendableArgs(args) }).finally(() => (asking.current = false));
          },
        ]),
      ) as unknown as Omit<PlayerControls, "canPlay">,
    [ask],
  );

  if (!ride || !computer) return null;
  const { data } = ride;
  const status = data.ended ? "Ended" : data.running ? formatTime(data.position) : data.autoPaused ? "Paused" : data.elapsed > 0 ? "Paused" : "Ready";

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-30 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left shadow-lg md:hidden"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{data.workout.name}</span>
          <span className="block truncate text-sm text-muted">
            On {computer} · <span className="num">{status}</span>
          </span>
        </span>
        <span className="flex-none text-sm font-medium text-primary">Controls</span>
      </button>
    );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ground pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center justify-between px-4">
        <p className="truncate text-sm text-muted">Riding on {computer}</p>
        <button type="button" className={button.small} onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
      <div className="space-y-3 px-3 pb-6">
        {lost && <Notice tone="warning">Can't reach {computer}. Check that Lactic is open there and both are on the same Wi-Fi.</Notice>}
        <PlayerView
          data={data}
          controls={{ ...controls, canPlay: ride.canPlay }}
          extra={
            data.elapsed > 0 && !data.ended && !data.finished ? (
              <button type="button" className={button.secondary} onClick={() => controls.onEnd()}>
                End ride
              </button>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Schedules, moves or drops the ride-end notification after an answer from the computer. Only a
 * real answer gets here: out of reach, the one already waiting stays. The end is compared in
 * 3-second steps so each second's answer doesn't reschedule it.
 */
function syncEndAlert(ride: OverlayPayload | null, computer: string | null, last: { current: string }) {
  if (!computer) return;
  const d = ride?.data ?? null;
  const alert = endAlert(d && { ...d, workoutName: d.workout.name }, computer);
  if (!alert || !d) {
    if (last.current !== "none") void cancelRideEnd().catch(() => {});
    last.current = "none";
    return;
  }
  const at = alert.inSeconds === 0 ? "now" : Math.round((Date.now() / 1000 + alert.inSeconds) / 3);
  const sig = `${alert.key}|${alert.extendLabel}|${at}`;
  if (sig === last.current) return;
  last.current = sig;
  void scheduleRideEnd({ ...alert, computer, workoutName: d.workout.name, duration: d.duration }).catch(() => {});
}
