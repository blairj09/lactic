// The iPhone as a remote for a ride on the computer. While Lactic's Ride page is open on the paired
// computer, a bar above the tabs says so; tapping it opens the ride as the computer shows it, with
// its controls (start and pause, skip, intensity, ERG, extend, end). Presses go to the computer and
// run there, as if clicked on it. Asks every few seconds in the background, every second while open.
//
// The workout's end: a notification with Extend and End buttons. The phone hears nothing from the
// computer while it's locked, so each answer moves a notification scheduled for the end (Swift
// keeps it, and runs the buttons from the lock screen or a watch); paused or ended, it's dropped.
// Open at the end, the remote opens itself on the Extend panel.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { RemoteView, formatTime, type PlayerControls } from "@/app/ride/player";
import { Notice, button } from "@/components/ui";
import { isRiding } from "@/lib/live-ride";
import { endAlert, endAlertKey } from "@/lib/ride/end-alert";
import { sendableArgs, type ControlMessage, type ControlName, type OverlayPayload } from "~/ride/channel";
import { useKeepAwake } from "~/platform/keep-awake";
import { cancelRideEnd, phoneStatus, scheduleRideEnd, send } from "./plugin";

interface Reply {
  ride: OverlayPayload | null;
}

const OPEN_EVERY = 1000;
const CLOSED_EVERY = 5000;

const NAMES: ControlName[] = ["onPlayPause", "onSkip", "onBack", "onIntensity", "onErg", "onErgMode", "onGrade", "onExtend", "onEnd", "onExtendMinutes", "onExtendWatts", "onExtendKind", "onExtendBlock", "onHold", "onAdaptUndo", "onAdaptYes", "onAdaptNo", "onAdaptive"];

/** The ride open on the paired computer, for the phone's Ride tab: it opens the remote instead. */
export interface AwayRide {
  computer: string;
  workout: string;
  status: string;
}
let away: AwayRide | null = null;
const awayListeners = new Set<() => void>();
let openRemoteNow: (() => void) | null = null;
function setAway(next: AwayRide | null) {
  if (away?.computer === next?.computer && away?.workout === next?.workout && away?.status === next?.status) return;
  away = next;
  awayListeners.forEach((l) => l());
}
export function useComputerRide(): AwayRide | null {
  return useSyncExternalStore(
    (l) => (awayListeners.add(l), () => void awayListeners.delete(l)),
    () => away,
    () => null,
  );
}
/** Opens the remote over whatever screen is showing. */
export function openRemote() {
  openRemoteNow?.();
}

/**
 * The phone's Ride tab while the computer's Ride page is open: the computer holds the trainer, so
 * this says where the ride is and opens its controls, instead of a second ride screen.
 */
export function RidingOnComputer({ ride }: { ride: AwayRide }) {
  // Coming to the Ride tab means wanting the controls: open them straight away, once.
  useEffect(() => openRemote(), []);
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <p className="text-sm text-muted">Riding on {ride.computer}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{ride.workout}</h1>
        <p className="num text-muted">{ride.status}</p>
      </div>
      <button type="button" className={`${button.primary} h-12 w-full text-base`} onClick={() => openRemote()}>
        Open controls
      </button>
      <p className="text-sm text-muted">Your computer has the trainer. To ride with this iPhone instead, end the ride there first.</p>
    </div>
  );
}

export function ComputerRide() {
  const [computer, setComputer] = useState<string | null>(null);
  const [ride, setRide] = useState<OverlayPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [lost, setLost] = useState(false);
  // The Ride tab shows the ride itself (RidingOnComputer), so the bar would say it twice.
  const onRideTab = useLocation().pathname === "/ride";
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

  useEffect(() => {
    openRemoteNow = () => setOpen(true);
    return () => {
      openRemoteNow = null;
      setAway(null);
    };
  }, []);

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

  const data = ride?.data;
  const status = !data ? "" : data.ended ? "Ended" : data.running ? formatTime(data.position) : data.autoPaused ? "Paused" : data.elapsed > 0 ? "Paused" : "Ready";
  useEffect(() => setAway(ride && computer && data ? { computer, workout: data.workout.name, status } : null), [ride, computer, data, status]);
  // The remote's open (or the Ride tab's showing the computer's ride): the screen stays on until the ride ends.
  useKeepAwake(!!data && !data.ended && (open || onRideTab));

  if (!ride || !computer || !data) return null;

  if (!open)
    return onRideTab ? null : (
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
    <div className="fixed inset-0 z-50 flex flex-col bg-ground pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 flex-none items-center justify-between px-4">
        <p className="truncate text-sm text-muted">Riding on {computer}</p>
        <button type="button" className={button.small} onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
      <RemoteView
        data={data}
        controls={{ ...controls, canPlay: ride.canPlay }}
        notice={lost && <Notice tone="warning">Can't reach {computer}. Check that Lactic is open there and Wi-Fi is on for both.</Notice>}
        extra={
          data.elapsed > 0 && !data.ended && !data.finished ? (
            <button type="button" className={`${button.ghost} h-10 w-full`} onClick={() => controls.onEnd()}>
              End ride
            </button>
          ) : undefined
        }
      />
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
