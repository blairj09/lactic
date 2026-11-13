"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { isRiding, setLiveRide } from "@/lib/live-ride";
import { POWER_SOURCE_PREF, SensorHub, isWebBluetoothAvailable, type PowerSource } from "@/lib/ble/sensor-hub";
import { rampTestFtp, twentyMinuteTestFtp } from "@/lib/engine/ftp";
import { isRampTest, type Levels, type Session } from "@/lib/engine/library";
import { intervalAt, intervals, scaleWorkout, targetWattsAt, workoutDuration, type Workout } from "@/lib/engine/workout";
import { workoutFromFile } from "@/lib/engine/erg";
import { AutoPause, easeIn } from "@/lib/ride/auto-pause";
import { AutoStart } from "@/lib/ride/auto-start";
import { BLOCKS, DEFAULT_BLOCK, EXTEND_KINDS, clampMinutes, defaultExtendWatts, extendWorkout, extensionMinutes, type ExtendKind, type Extension } from "@/lib/ride/extend";
import { templateById } from "@/lib/engine/templates";
import { customKey, isTwentyMinuteTest, libraryKey, librarySession as starterSession, libraryWorkout, WORKOUT_LIBRARY, type LibraryWorkout } from "@/lib/engine/workout-library";
import FavoriteButton from "@/components/favorite-button";
import { RideClock } from "@/lib/ride/clock";
import { rideTotals } from "@/lib/ride/totals";
import { SPRINT_GRADE, allOutAt, clampGrade, freeRideAt } from "@/lib/ride/sprint";
import { blankWorkout } from "@/lib/engine/workout-edit";
import type { CustomWorkout } from "@/lib/custom-workouts";
import { ERG_STEP, addErgChange, clampErg, defaultErg, ergWorkout, type ErgChange } from "@/lib/ride/erg";
import { UNDO_SECONDS, adaptable, applyFactors, judge, readAt, readRep, sameKind, workReps, type Adaptation, type Change } from "@/lib/ride/adapt";
import { useExperiments } from "@/lib/use-experiments";
import Nav from "@/components/nav";
import { Notice, Page, Panel, Segmented, button, input } from "@/components/ui";
import { saveAppRide } from "../actions";
import { deleteCustomWorkout, phoneRideFields, saveCustomWorkout, saveRideFields, setFavorite } from "./actions";
import { allFields, pagesOf, standardSets, type RideSets } from "@/lib/ride/field-pages";
import { liveNumbers, showFields, type FieldInputs } from "@/lib/ride/fields";
import { MetricRegistry } from "@/lib/sdk/metrics";
import FieldEditor from "./field-editor";
import WorkoutChart from "./workout-chart";
import { holdCoachShortcut } from "../coach/open";
import { holdNewDayRefresh } from "@/lib/new-day";
import RideSurvey from "../ride-survey";
import { OVERLAY_SIZES, PlayerView, formatTime, type AdaptNotice, type PlayerControls, type PlayerData } from "./player";
import RideNow, { DEFAULT_LIBRARY, librarySession, type LibraryChoice, type RideSource } from "./ride-now";
import SensorPanel from "./sensor-panel";
import { usePipWindow, type OverlayFullScreen } from "./use-pip-window";
import OverlayPortal from "./overlay-portal";
import { RemoteHost } from "~/ride/remote";
import { pluginFieldOptions, usePluginFields, usePlugins } from "~/plugins/ride-fields";
import { RidingOnComputer, useComputerRide, type AwayRide } from "~/phone/remote";
import { useKeepAwake } from "~/platform/keep-awake";
import { isDesktop, isPhone } from "~/platform/native";
import { isDemo } from "~/demo/flag";
import type { TracePoint } from "./workout-chart";
import WorkoutEditor from "./workout-editor";
import SendToKaroo from "./send-to-karoo";
import RampTestResult from "./ramp-test-result";

const OVERLAY_PREF = "ride.overlayOnStart";

/** What the overlay does over full-screen apps on this computer (see OverlayFullScreen). */
const FULL_SCREEN_NOTE: Record<OverlayFullScreen, string> = {
  floats: "It stays on top of full-screen apps too.",
  browser: "It stays on top of other windows, but not over an app in macOS full screen: make that app a window filling the screen instead (Option-click its green button).",
  windows:
    "It stays on top of full-screen apps in borderless or windowed mode. Nothing can show over a game in exclusive full screen, so if the overlay disappears when the game fills the screen, set the game's display mode to borderless or windowed.",
  x11: "It stays on top of other windows. Some desktops put a full-screen app above everything, so if the overlay disappears, run that app as a window filling the screen (maximized or borderless) instead.",
  wayland:
    "On Wayland, apps can't keep their own windows on top, so turn it on once the overlay opens: click it, then press Alt+Space and pick Always on Top (GNOME), or Alt+F3 and pick More Actions, Keep Above Other Windows (KDE). Run the other app as a window filling the screen, not full screen.",
};
const OVERLAY_SIZE_PREF = "ride.overlaySize";
const SPRINT_GRADE_PREF = "ride.sprintGrade";
const AUTO_START_PREF = "ride.autoStart";
const EXTEND_KIND_PREF = "ride.extendKind";
const EXTEND_BLOCK_PREF = "ride.extendBlock";
const UPCOMING = 4;
/** Seconds of the current free ERG target drawn past the playhead. */
const ERG_AHEAD = 300;

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

type RideScreenProps = Parameters<typeof RideOnThisDevice>[0];

/**
 * The Ride tab. On an iPhone paired with a computer whose Ride page is open, the computer holds the
 * trainer: the tab opens the remote for that ride instead of a second ride screen reaching for it.
 */
export default function RideScreen(props: RideScreenProps) {
  const away = useComputerRide();
  if (away && isPhone() && !isRiding()) return <RidingOnComputerPage ride={away} />;
  return <RideOnThisDevice {...props} />;
}

function RidingOnComputerPage({ ride }: { ride: AwayRide }) {
  return (
    <>
      <Nav current="/ride" />
      <Page>
        <RidingOnComputer ride={ride} />
      </Page>
    </>
  );
}

function RideOnThisDevice({
  initialFtp,
  canSave,
  planned = null,
  plannedDay,
  plannedLabel = "Today",
  levels,
  saved = [],
  favorites: initialFavorites = [],
  today,
  ftpGuess = false,
  thresholdHr = null,
  weightKg = null,
  rideFields,
  initialSource,
}: {
  /** Weight from Settings, for W/kg fields. */
  weightKg?: number | null;
  /** The rider's ride field pages from their layout; Lactic standard when not given. */
  rideFields?: RideSets;
  /** Where the picker opens (Today's "Something else…" opens the library, My workouts or free ride); else the plan's session first. */
  initialSource?: RideSource;
  /** Threshold heart rate from Settings, for adaptive workouts to judge an easy rep. */
  thresholdHr?: number | null;
  initialFtp: number | null;
  /** FTP is still setup's guess, so a ramp test sets it straight away (with Undo) instead of asking. */
  ftpGuess?: boolean;
  canSave: boolean;
  /** The plan's session for the day, offered first. */
  planned?: Session | null;
  /** The plan day (YYYY-MM-DD) `planned` is for; saving a ride of it marks it ridden. */
  plannedDay?: string;
  plannedLabel?: string;
  /** Progression levels, so library workouts match where you are. */
  levels: Levels;
  /** My workouts, saved from the editor. */
  saved?: CustomWorkout[];
  /** Favorite workout keys (`library:<id>`, `custom:<id>`), newest first. */
  favorites?: string[];
  /** Today in your time zone; set when signed in, so a workout can be sent to the Karoo. */
  today?: string;
}) {
  const hub = useMemo(() => new SensorHub(), []);
  const state = useSyncExternalStore(hub.subscribe, hub.getState, hub.getState);
  const pip = usePipWindow();
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ftp, setFtp] = useState(initialFtp ?? 250);
  const [source, setSource] = useState<RideSource>(initialSource ?? (planned ? "planned" : "library"));
  const [library, setLibrary] = useState<LibraryChoice>(DEFAULT_LIBRARY);
  /** A .zwo file is being saved into My workouts. */
  const [importing, setImporting] = useState(false);
  /** Overlay, power source and FTP: set once, so they start collapsed. */
  const [setupOpen, setSetupOpen] = useState(false);
  const [baseWorkout, setBaseWorkout] = useState<Workout>(() => planned?.workout ?? librarySession(DEFAULT_LIBRARY, levels).workout);
  /** The My workouts entry loaded (or just saved), so Save updates it. */
  const [customId, setCustomId] = useState<string | null>(null);
  /** The starter library workout loaded. */
  const [starterId, setStarterId] = useState<string | null>(null);
  /** A ridden workout saved to My workouts to favorite it. */
  const [keptId, setKeptId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set(initialFavorites));
  /** The loaded workout was changed in the editor. */
  const [edited, setEdited] = useState(false);
  /** Bumped on each load, so the editor's undo history starts fresh. */
  const [loads, setLoads] = useState(0);
  /** The editor starts collapsed; New workout opens it. */
  const [editorOpen, setEditorOpen] = useState(false);
  const [ergWatts, setErgWatts] = useState(() => defaultErg(initialFtp ?? 250));
  const ergRef = useRef(ergWatts);
  const ergChanges = useRef<ErgChange[]>([{ at: 0, watts: ergWatts }]);
  const [overlaySize, setOverlaySize] = useState(1);
  const [intensity, setIntensity] = useState(100);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [overlayOnStart, setOverlayOnStart] = useState(true);
  const clock = useRef(new RideClock());
  const elapsedRef = useRef(0);
  /** Seconds skipped, so the workout position can run ahead of the ride clock. */
  const offset = useRef(0);
  const samples = useRef<number[]>([]);
  const hrSamples = useRef<number[]>([]);
  /** Per ride second, for the ride's page: cadence, the watts asked for (null in free ride) and the interval it was in. */
  const cadenceSamples = useRef<number[]>([]);
  const targetSamples = useRef<(number | null)[]>([]);
  const intervalSamples = useRef<number[]>([]);
  const trace = useRef<TracePoint[]>([]);
  const metrics = useMemo(() => new MetricRegistry(), []);
  const plugins = usePlugins();
  /** The rider's field pages, the page on screen, and the field editor (only before a ride). */
  const [fieldSets, setFieldSets] = useState<RideSets>(() => rideFields ?? standardSets());
  // A paired iPhone's own pages: their numbers are worked out here too, for its remote (phone/remote.tsx).
  const [phoneSets, setPhoneSets] = useState<RideSets | null>(null);
  useEffect(() => {
    if (isDesktop && !isPhone()) void phoneRideFields().then(setPhoneSets);
  }, []);
  const [fieldPage, setFieldPage] = useState(0);
  const [editingFields, setEditingFields] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const editingFieldsRef = useRef(false);
  editingFieldsRef.current = editingFields;
  const startedAt = useRef<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  /** The saved ride, for a link to its page. */
  const [savedId, setSavedId] = useState<string | null>(null);
  /** The ride just saved, for the after-ride survey. */
  const [survey, setSurvey] = useState<{ appStartedAt: string; name: string; session: Pick<Session, "zone" | "level" | "duration" | "stress"> | null } | null>(null);
  /** The FTP a just-saved ramp test gives, offered with a confirm. */
  const [rampResult, setRampResult] = useState<ReturnType<typeof rampTestFtp>>(null);
  /** The FTP a just-saved 20-minute test gives. */
  const [twentyResult, setTwentyResult] = useState<ReturnType<typeof twentyMinuteTestFtp>>(null);
  const lastSentTarget = useRef<number | null>(null);
  /** ERG off: the trainer simulates a road at `grade` and you ride the targets by feel. */
  const [ergOn, setErgOn] = useState(true);
  const ergOnRef = useRef(true);
  const [grade, setGrade] = useState(0);
  /** With ERG on, sprints let go of ERG and ride a road at this grade, so they aren't capped. */
  const [sprintGrade, setSprintGrade] = useState(SPRINT_GRADE);
  const sprintGradeRef = useRef(SPRINT_GRADE);
  const gradeRef = useRef(0);
  /** The grade sent while the trainer is on the road for a sprint or a free ride, not holding a target. */
  const sprinting = useRef<number | null>(null);
  const autoPause = useRef(new AutoPause());
  const [autoPaused, setAutoPaused] = useState(false);
  /** Ride second of the last auto-resume, while ERG eases back up to the target. */
  const easeFrom = useRef<number | null>(null);
  /** The workout ran to its end, so pedaling on doesn't restart it. */
  const finished = useRef(false);
  /** Start pedaling with a ride picked and it starts by itself (on unless turned off in Setup). */
  const [autoStartOn, setAutoStartOn] = useState(true);
  const autoStartOnRef = useRef(true);
  const autoStart = useRef(new AutoStart());
  /** Seconds until an auto-start, while you pedal before the ride. */
  const [startIn, setStartIn] = useState<number | null>(null);
  /** At the workout's end: how long to extend it by, and the watts for an ERG block (null: a default from the workout). */
  const [extendMinutes, setExtendMinutes] = useState(5);
  const [extendWatts, setExtendWatts] = useState<number | null>(null);
  /** What Extend adds: a free ride, an ERG hold or a workout block (remembered between rides). */
  const [extendKind, setExtendKind] = useState<ExtendKind>("erg");
  const [extendBlock, setExtendBlock] = useState(DEFAULT_BLOCK);
  /** Set by Extend: the ride resumes once the longer workout is in place. */
  const resumeAfterExtend = useRef(false);
  /** End was pressed: the ride is over, saved (when it can be) and the survey shows. */
  const [ended, setEnded] = useState(false);
  const endPanel = useRef<HTMLDivElement>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Adaptive workouts (an experiment): later reps eased (or, with a yes, made harder) by a factor each.
  const adaptExperiment = useExperiments().adaptive_workouts;
  /** This ride's switch, in the ride controls. */
  const [adaptOn, setAdaptOn] = useState(true);
  const [factors, setFactors] = useState<ReadonlyMap<number, number>>(() => new Map());
  /** The change on screen: an ease with Undo until `until` (ride seconds), or a bump to answer before its first rep. */
  const [adaptShown, setAdaptShown] = useState<{ change: Change; before: ReadonlyMap<number, number>; until: number; log: number } | null>(null);
  const adaptLog = useRef<Adaptation[]>([]);
  /** Reps already read, segments paused in, and whether the rider moved intensity since the last read. */
  const repsRead = useRef(new Set<number>());
  const pausedIn = useRef(new Set<number>());
  const steered = useRef(false);
  const bumpDeclined = useRef(false);
  const easeUndone = useRef(false);

  const erg = source === "erg";
  const workout = useMemo(() => scaleWorkout(applyFactors(baseWorkout, factors), intensity / 100), [baseWorkout, factors, intensity]);
  const reps = useMemo(() => workReps(baseWorkout), [baseWorkout]);
  const adaptive = adaptExperiment && !erg && !isRampTest(baseWorkout) && !isTwentyMinuteTest(baseWorkout) && adaptable(baseWorkout) && reps.length > 1;
  const duration = workoutDuration(workout);

  useEffect(() => setSupported(isWebBluetoothAvailable()), []);
  useEffect(() => {
    // On unless turned off: clicking Start opens the overlay on top of other windows.
    setOverlayOnStart(readPref(OVERLAY_PREF) !== "0");
    const size = Number(readPref(OVERLAY_SIZE_PREF));
    if (Number.isInteger(size) && size >= 0 && size < OVERLAY_SIZES.length) setOverlaySize(size);
    if (readPref(POWER_SOURCE_PREF) === "powerMeter") hub.setPowerSource("powerMeter");
    if (readPref(AUTO_START_PREF) === "0") {
      autoStartOnRef.current = false;
      setAutoStartOn(false);
    }
    const kind = readPref(EXTEND_KIND_PREF);
    if (EXTEND_KINDS.some((k) => k.kind === kind)) setExtendKind(kind as ExtendKind);
    const block = readPref(EXTEND_BLOCK_PREF);
    if (templateById(block)) setExtendBlock(block!);
    const savedGrade = readPref(SPRINT_GRADE_PREF);
    if (savedGrade !== null && Number.isFinite(Number(savedGrade))) {
      sprintGradeRef.current = clampGrade(Number(savedGrade));
      setSprintGrade(sprintGradeRef.current);
    }
  }, [hub]);

  /** Logs how a change on screen ended and clears it. */
  const settleAdapt = (outcome: Adaptation["outcome"]) => {
    if (!adaptShown) return;
    adaptLog.current[adaptShown.log] = { ...adaptLog.current[adaptShown.log], outcome };
    setAdaptShown(null);
  };

  // Once a second: an ease's Undo runs out, an unanswered bump lapses (keeping the plan), and a
  // finished rep is read once, a minute into its recovery.
  const checkAdapt = useRef((_position: number, _now: number) => {});
  checkAdapt.current = (position, now) => {
    if (adaptShown) {
      if (adaptShown.change.kind === "ease" && now >= adaptShown.until) settleAdapt("applied");
      else if (adaptShown.change.kind === "bump" && position >= adaptShown.until) {
        bumpDeclined.current = true;
        settleAdapt("declined");
      }
    }
    if (!adaptive || !adaptOn) return;
    for (const rep of reps) {
      if (repsRead.current.has(rep.index)) continue;
      const at = readAt(baseWorkout, rep);
      if (position < at) break;
      repsRead.current.add(rep.index);
      // Skipped past it, or read long ago: nothing to go on.
      if (position > at + 30) continue;
      const ride = { power: samples.current, heartRate: hrSamples.current, cadence: cadenceSamples.current, target: targetSamples.current, interval: intervalSamples.current };
      const reads = reps.filter((r) => r.index <= rep.index && sameKind(r, rep)).map((r) => readRep(ride, r, pausedIn.current)).filter((r) => r.seconds > 0);
      if (!reads.length || reads[reads.length - 1].index !== rep.index) continue;
      const change = judge({
        reps,
        rep,
        reads,
        position,
        factors,
        ergOn: ergOnRef.current,
        thresholdHr,
        riderSteered: steered.current,
        bumpDeclined: bumpDeclined.current,
        easeUndone: easeUndone.current,
      });
      steered.current = false;
      if (!change) continue;
      if (adaptShown) settleAdapt(adaptShown.change.kind === "ease" ? "applied" : "declined");
      const interval = (i: number) => i + 1;
      const log = adaptLog.current.push({ at: now, kind: change.kind, percent: change.percent, intervals: change.reps.map(interval), reasons: change.reasons, outcome: change.kind === "ease" ? "applied" : "declined" }) - 1;
      const first = reps.find((r) => r.index === change.reps[0])!;
      setAdaptShown({ change, before: factors, until: change.kind === "ease" ? now + UNDO_SECONDS : first.start, log });
      if (change.kind === "ease") setFactors(withFactor(factors, change.reps, change.factor));
    }
  };

  // The tick reads the latest values through a ref, so the timers below never need restarting.
  const tick = useRef(() => {});
  tick.current = () => {
    if (!clock.current.running) return;
    // Catch up to the wall clock: a throttled timer may have missed seconds.
    const now = clock.current.elapsed(Date.now());
    const { powerWatts, heartRate, cadenceRpm } = hub.getState();
    while (samples.current.length < now) {
      const at = samples.current.length + offset.current;
      samples.current.push(powerWatts ?? 0);
      hrSamples.current.push(heartRate ?? 0);
      cadenceSamples.current.push(Math.round(cadenceRpm ?? 0));
      targetSamples.current.push(erg ? ergRef.current : targetWattsAt(workout, at, ftp));
      intervalSamples.current.push(erg ? -1 : (intervalAt(workout, at)?.index ?? -1));
      trace.current.push([samples.current.length + offset.current, powerWatts ?? 0, heartRate ?? 0, Math.round(cadenceRpm ?? 0)]);
    }
    if (now !== elapsedRef.current) {
      elapsedRef.current = now;
      setElapsed(now);
    }
    const position = now + offset.current;
    checkAdapt.current(position, now);
    const planned = erg ? ergRef.current : targetWattsAt(workout, position, ftp);
    if (!erg && planned === null && position >= duration) {
      clock.current.pause(Date.now());
      finished.current = true;
      setRunning(false);
    }
    if (easeFrom.current !== null && now - easeFrom.current >= 10) easeFrom.current = null;
    // A sprint or a free ride: off ERG and onto the road until it's over, then the next target goes
    // back as usual. Sprints ride the sprint grade, free rides the grade you set.
    const road = !ergOnRef.current || erg ? null : allOutAt(workout, position) ? sprintGradeRef.current : freeRideAt(workout, position) ? gradeRef.current : null;
    if (road !== null) {
      if (sprinting.current !== road) {
        sprinting.current = road;
        lastSentTarget.current = null;
        hub.setSimulationGrade(road).catch((e) => setError(String(e)));
      }
      return;
    }
    sprinting.current = null;
    const target = planned !== null && easeFrom.current !== null ? easeIn(planned, now - easeFrom.current) : planned;
    if (ergOnRef.current && target !== null && target !== lastSentTarget.current) {
      lastSentTarget.current = target;
      hub.setTargetPower(target).catch((e) => setError(String(e)));
    }
  };

  // Three tick sources, since Chrome throttles timers in a tab hidden behind other windows: this page's
  // timer, the overlay's timer (its window stays visible, so it isn't throttled), and every sensor
  // reading (Bluetooth notifications arrive several times a second regardless).
  useEffect(() => {
    if (!running) return;
    const run = () => tick.current();
    const timers = [window, pip.pip].filter((w): w is Window => w !== null).map((w) => [w, w.setInterval(run, 250)] as const);
    const unsubscribe = hub.subscribe(run);
    return () => {
      timers.forEach(([w, id]) => w.clearInterval(id));
      unsubscribe();
    };
  }, [running, pip.pip, hub]);

  // Warn before leaving with a ride that hasn't been saved.
  const unsaved = canSave && elapsed >= 60 && saveState !== "saved";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // No ⌘K coach drawer over the workout; the top bar's Coach button still opens it.
  useEffect(() => (running ? holdCoachShortcut() : undefined), [running]);

  // No new-day refresh from the moment a ride starts until it's saved or thrown away.
  const midRide = running || (elapsed > 0 && saveState !== "saved");
  useEffect(() => (midRide ? holdNewDayRefresh() : undefined), [midRide]);
  // The coach's app check reads the sensors from here, and only looks while a ride is under way.
  useEffect(() => setLiveRide({ hub, riding: midRide }), [hub, midRide]);
  useEffect(() => () => setLiveRide(null), []);

  // Keep the screen awake mid-ride, and while the trainer's connected (a ride waiting for the first pedal stroke).
  useKeepAwake(midRide || !!state.connected.trainer);

  const openOverlay = () => {
    const { width, height } = OVERLAY_SIZES[overlaySize];
    pip.open(width, height).catch((e) => setError(`Couldn't open the overlay: ${String(e)}`));
  };

  // A step bigger or smaller, from the shrink and enlarge buttons in the overlay (the click there lets it resize itself).
  const resizeOverlay = (step: 1 | -1) => {
    const next = Math.min(OVERLAY_SIZES.length - 1, Math.max(0, overlaySize + step));
    setOverlaySize(next);
    writePref(OVERLAY_SIZE_PREF, String(next));
    const { width, height } = OVERLAY_SIZES[next];
    try {
      pip.pip?.resizeTo(width, height);
    } catch {}
  };

  /** Starts the ride from the button, or by itself when you pedal (`auto`). */
  const start = (auto = false) => {
    autoStart.current.reset();
    setStartIn(null);
    if (elapsedRef.current === 0) {
      samples.current = [];
      hrSamples.current = [];
      cadenceSamples.current = [];
      targetSamples.current = [];
      intervalSamples.current = [];
      trace.current = [];
      offset.current = 0;
      lastSentTarget.current = null;
      ergChanges.current = [{ at: 0, watts: ergRef.current }];
      startedAt.current = new Date().toISOString();
      setSaveState("idle");
      setNotice(null);
    }
    // In Chrome, opening the overlay needs the click that started the ride, so it happens here (and
    // can't when pedaling started it). The desktop app's overlay opens either way.
    if ((!auto || !pip.needsClick) && overlayOnStart && pip.supported && !pip.pip) openOverlay();
    resume();
  };

  const resume = () => {
    finished.current = false;
    // Sent again at the first tick, in case the trainer did something else while paused.
    sprinting.current = null;
    autoPause.current.reset();
    setAutoPaused(false);
    // ERG off: make sure the trainer is on the road, whatever it was doing before.
    if (!ergOnRef.current && hub.getState().connected.trainer) hub.setSimulationGrade(grade).catch((e) => setError(String(e)));
    clock.current.start(Date.now());
    // Mid-ride, ERG eases back up rather than starting at the full target.
    easeFrom.current = elapsedRef.current > 0 ? elapsedRef.current : null;
    setRunning(true);
    tick.current();
  };

  const pause = () => {
    tick.current();
    notePause();
    clock.current.pause(Date.now());
    autoPause.current.reset();
    setAutoPaused(false);
    setRunning(false);
  };

  /** Remembers the interval a pause came in, for adaptive workouts to count it as a sign of struggle. */
  const notePause = () => {
    const at = intervalAt(workout, elapsedRef.current + offset.current);
    if (at && elapsedRef.current > 0) pausedIn.current.add(at.index);
  };
  const notePauseRef = useRef(notePause);
  notePauseRef.current = notePause;

  const startRef = useRef(start);
  startRef.current = start;

  // Auto-start and auto-pause: watch every sensor reading, before the ride and while it's under way.
  useEffect(() => {
    const unsubscribe = hub.subscribe(() => {
      const { cadenceRpm, powerWatts, targetWatts, connected } = hub.getState();
      if (!startedAt.current) {
        // Pedaling doesn't start the ride while the fields are being customized.
        if (editingFieldsRef.current) {
          autoStart.current.reset();
          return setStartIn(null);
        }
        if (!autoStartOnRef.current || !connected.trainer) return;
        const now = Date.now();
        if (autoStart.current.update(cadenceRpm, powerWatts, now)) startRef.current(true);
        else {
          const left = autoStart.current.countdown(now);
          setStartIn((was) => (was === left ? was : left));
        }
        return;
      }
      if (finished.current) return;
      const action = autoPause.current.update(clock.current.running, cadenceRpm, powerWatts, Date.now());
      if (action === "pause") {
        tick.current();
        notePauseRef.current();
        clock.current.pause(Date.now());
        setRunning(false);
        setAutoPaused(true);
        // Drop ERG now, so the first strokes back aren't against the full target.
        if (ergOnRef.current && targetWatts !== undefined) {
          const low = easeIn(targetWatts, 0);
          lastSentTarget.current = low;
          hub.setTargetPower(low).catch(() => undefined);
        }
      } else if (action === "resume") {
        clock.current.start(Date.now());
        easeFrom.current = clock.current.elapsed(Date.now());
        setRunning(true);
        setAutoPaused(false);
        tick.current();
      }
    });
    return () => void unsubscribe();
  }, [hub]);

  const reset = () => {
    clock.current.reset();
    setRunning(false);
    setElapsed(0);
    elapsedRef.current = 0;
    offset.current = 0;
    samples.current = [];
    hrSamples.current = [];
    cadenceSamples.current = [];
    targetSamples.current = [];
    intervalSamples.current = [];
    trace.current = [];
    lastSentTarget.current = null;
    sprinting.current = null;
    ergChanges.current = [{ at: 0, watts: ergRef.current }];
    startedAt.current = null;
    autoStart.current.reset();
    setStartIn(null);
    setExtendWatts(null);
    resumeAfterExtend.current = false;
    autoPause.current.reset();
    setAutoPaused(false);
    easeFrom.current = null;
    finished.current = false;
    setEnded(false);
    setSaveState("idle");
    setNotice(null);
    setSurvey(null);
    setRampResult(null);
    setTwentyResult(null);
    setKeptId(null);
    setFactors(new Map());
    setAdaptShown(null);
    adaptLog.current = [];
    repsRead.current = new Set();
    pausedIn.current = new Set();
    steered.current = false;
    bumpDeclined.current = false;
    easeUndone.current = false;
  };

  /** Loads a workout into the player (only before a ride starts: Ride now is locked after). */
  const ride = (next: RideSource, base?: Workout, savedId: string | null = null) => {
    setSource(next);
    if (base) setBaseWorkout(base);
    setCustomId(savedId);
    setEdited(false);
    setLoads((n) => n + 1);
    setIntensity(100);
    setAdaptOn(true);
    reset();
  };

  const pickSource = (next: RideSource) => {
    if (next === "planned" && planned) ride(next, planned.workout);
    else if (next === "library") ride(next, librarySession(library, levels).workout);
    else if (next === "custom") {
      // My workouts opens on your saved ones, or on the starter library before you've saved any.
      if (saved.length) ride(next, saved[0].workout, saved[0].id);
      else pickStarter(libraryWorkout(starterId) ?? WORKOUT_LIBRARY.find((w) => w.category === "endurance") ?? WORKOUT_LIBRARY[0]);
    }
    else {
      // Free ERG is nothing without ERG.
      if (!ergOnRef.current) setErgMode(true);
      ride(next);
    }
  };

  const pickStarter = (entry: LibraryWorkout) => {
    setStarterId(entry.id);
    ride("starter", entry.workout);
  };

  /** Adds a workout to favorites or takes it off, at once on screen and then in the database. */
  const toggleFavorite = async (key: string, on: boolean) => {
    const flip = (add: boolean) =>
      setFavorites((current) => {
        const rest = [...current].filter((k) => k !== key);
        return new Set(add ? [key, ...rest] : rest);
      });
    flip(on);
    const result = await setFavorite(key, on);
    if (!result.ok) {
      flip(!on);
      setError(result.message);
    }
  };

  /** The workout just ridden, as a favorite key: the library workout or saved one it was, unless edited. */
  const ridden = (): string | null => {
    if (keptId) return customKey(keptId);
    if (edited) return source === "custom" && customId ? customKey(customId) : null;
    if (source === "starter" && starterId) return libraryKey(starterId);
    if (source === "planned" && planned?.library && !planned.edited) return libraryKey(planned.library);
    if (source === "planned" && planned?.custom && !planned.edited) return customKey(planned.custom);
    if (source === "custom" && customId) return customKey(customId);
    return null;
  };

  /** Favorites the ride's workout; one that isn't in the library or My workouts is saved to My workouts first. */
  const favoriteRidden = async () => {
    const key = ridden();
    if (key) return toggleFavorite(key, !favorites.has(key));
    const result = await saveCustomWorkout({ workout });
    if (!result.ok) return setError(result.message);
    setKeptId(result.id);
    await toggleFavorite(customKey(result.id), true);
  };

  const pickLibrary = (choice: LibraryChoice) => {
    setLibrary(choice);
    ride("library", librarySession(choice, levels).workout);
  };

  const removeCustom = async (entry: CustomWorkout) => {
    if (!window.confirm(`Delete “${entry.workout.name}” from My workouts?`)) return;
    const result = await deleteCustomWorkout(entry.id);
    if (!result.ok) setError(result.message);
    else if (entry.id === customId) setCustomId(null);
  };

  /** An edit from the workout editor: it applies to this ride, and mid-ride takes effect at once. */
  const editWorkout = (next: Workout) => {
    setBaseWorkout(next);
    setEdited(true);
  };

  /** Moves the free ERG target; mid-ride the change goes into the ride's target history. */
  const setErg = (watts: number) => {
    const target = clampErg(watts);
    ergRef.current = target;
    setErgWatts(target);
    ergChanges.current = elapsedRef.current > 0 ? addErgChange(ergChanges.current, elapsedRef.current, target) : [{ at: 0, watts: target }];
    if (running) tick.current();
  };

  const pickPowerSource = (next: PowerSource) => {
    hub.setPowerSource(next);
    writePref(POWER_SOURCE_PREF, next);
  };

  const save = async () => {
    const started = startedAt.current;
    if (!started) return;
    setSaveState("saving");
    const result = await saveAppRide({
      startedAt: started,
      name: workout.name,
      watts: samples.current,
      heartRate: hrSamples.current,
      cadence: cadenceSamples.current,
      target: targetSamples.current,
      interval: intervalSamples.current,
      workout: erg ? undefined : workout,
      plannedWorkoutId: source === "planned" ? plannedDay : undefined,
      adaptations: adaptLog.current,
    });
    setSaveState(result.ok ? "saved" : "idle");
    if (result.ok) {
      setNotice(result.message);
      setRampResult(isRampTest(workout) && !edited ? rampTestFtp(samples.current) : null);
      setTwentyResult(isTwentyMinuteTest(workout) && !edited ? twentyMinuteTestFtp(samples.current) : null);
      setSavedId(result.rideId ?? null);
      // A library workout at full intensity can move its zone's level; a planned one is moved through its plan day.
      const starter = source === "starter" ? libraryWorkout(starterId) : null;
      const libraryRide = intensity !== 100 || edited ? null : source === "library" ? librarySession(library, levels) : starter ? starterSession(starter) : null;
      setSurvey({
        appStartedAt: started,
        name: workout.name,
        session: libraryRide && { zone: libraryRide.zone, level: libraryRide.level, duration: libraryRide.duration, stress: libraryRide.stress },
      });
    } else setError(result.message);
  };

  /** Imports a .zwo, .erg or .mrc file into My workouts (signed in) and loads it. */
  const importZwo = async (picked: File) => {
    let workout: Workout;
    try {
      workout = workoutFromFile(await picked.text(), picked.name, ftp);
    } catch (e) {
      setError(`Couldn't read that workout: ${String(e)}`);
      return;
    }
    if (!canSave) return ride("custom", workout, null);
    setImporting(true);
    const result = await saveCustomWorkout({ workout });
    setImporting(false);
    if (!result.ok) setError(result.message);
    ride("custom", workout, result.ok ? result.id : null);
  };

  const toggleAutoStart = (on: boolean) => {
    autoStartOnRef.current = on;
    setAutoStartOn(on);
    autoStart.current.reset();
    setStartIn(null);
    writePref(AUTO_START_PREF, on ? "1" : "0");
  };

  /** Adds a block or a free ride after the workout's end and rides on into it. */
  const extend = () => {
    setBaseWorkout((b) => extendWorkout(b, extension, ftp, intensity / 100));
    resumeAfterExtend.current = true;
  };
  // After Extend, resume once the longer workout is in place, so the tick doesn't finish it again.
  useEffect(() => {
    if (!resumeAfterExtend.current) return;
    resumeAfterExtend.current = false;
    resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseWorkout]);

  /**
   * Ends the ride: stops the clock, lets the trainer go, closes the overlay and saves, then brings
   * the page and its survey into view.
   */
  const end = () => {
    pause();
    finished.current = true;
    setEnded(true);
    resumeAfterExtend.current = false;
    lastSentTarget.current = null;
    sprinting.current = null;
    // Nothing to hold any more: a flat road, so you can spin down.
    if (hub.getState().connected.trainer) hub.setSimulationGrade(0).catch(() => undefined);
    pip.close();
    window.focus();
    if (canSave && elapsedRef.current >= 60 && saveState === "idle") void save();
    window.setTimeout(() => endPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const toggleOverlayOnStart = (on: boolean) => {
    setOverlayOnStart(on);
    writePref(OVERLAY_PREF, on ? "1" : "0");
  };

  const position = elapsed + offset.current;
  const shown = erg ? ergWorkout(ergChanges.current, position, ftp, ERG_AHEAD) : workout;
  const current = erg ? null : intervalAt(workout, position);
  const allOut = !erg && allOutAt(workout, position);
  const freeRide = !erg && freeRideAt(workout, position);
  const workoutDone = !erg && !running && elapsed > 0 && position >= duration;
  const extendWattsShown = extendWatts ?? defaultExtendWatts(baseWorkout, ftp, intensity / 100);
  const blockTemplate = templateById(extendBlock) ?? BLOCKS[0];
  const extension: Extension =
    extendKind === "erg"
      ? { kind: "erg", watts: extendWattsShown, minutes: extendMinutes }
      : extendKind === "freeRide"
        ? { kind: "freeRide", minutes: extendMinutes }
        : { kind: "block", template: blockTemplate.id, level: levels[blockTemplate.zone], minutes: extendMinutes };
  /** An ERG hold added at the end is under way: − and + move its watts. */
  const holding = current?.segment.kind === "steady" && !!current.segment.hold;
  const all = erg ? [] : intervals(workout);
  /** The change on screen in watts: the first changed rep, after and before. */
  const adaptNotice = (): AdaptNotice | null => {
    if (!adaptShown || ended) return null;
    const { change, before, until } = adaptShown;
    const first = change.reps[0];
    const seg = baseWorkout.segments[first];
    if (!seg || seg.kind !== "steady") return null;
    const watts = (f: number) => Math.round(seg.target * f * (intensity / 100) * ftp);
    const was = watts(before.get(first) ?? 1);
    return {
      kind: change.kind,
      percent: change.percent,
      watts: watts(change.factor),
      was,
      reps: change.reps.length,
      reasons: change.reasons,
      undoIn: change.kind === "ease" ? Math.max(0, until - elapsed) : null,
    };
  };
  const recent = samples.current.slice(-3);
  const ridePages = pagesOf(fieldSets, erg ? "free" : "workout");
  const fieldRefs = phoneSets ? [...allFields(fieldSets), ...allFields(phoneSets)] : allFields(fieldSets);
  const fieldInputs: FieldInputs = {
    streams: { power: samples.current, heartRate: hrSamples.current, cadence: cadenceSamples.current, interval: intervalSamples.current },
    ftp,
    weightKg,
    thresholdHr,
    power: state.powerWatts,
    heartRate: state.heartRate,
    cadence: state.cadenceRpm === undefined ? undefined : Math.round(state.cadenceRpm),
    interval: current?.index ?? null,
    toGo: erg ? null : Math.max(0, duration - position),
    elapsed,
  };
  // Plugin fields run in their sandbox once a ride second; the ride never waits on them.
  const pluginValues = usePluginFields(
    plugins,
    fieldRefs.flatMap((r) => ("metric" in r ? [r.metric] : [])),
    {
      ...liveNumbers(fieldInputs),
      "power.target": erg ? ergWatts : allOut ? null : targetWattsAt(workout, position, ftp),
      "interval.left": current && !erg ? Math.max(0, current.end - position) : null,
    },
    elapsed,
    running,
  );
  const fieldValues = { ...showFields(fieldRefs, fieldInputs, metrics), ...pluginValues };
  const data: PlayerData = {
    workout: shown,
    ftp,
    position,
    duration: erg ? workoutDuration(shown) : duration,
    current,
    upcoming: current ? all.slice(current.index + 1, current.index + 1 + UPCOMING) : [],
    intervalCount: all.length,
    targetWatts: erg ? ergWatts : allOut ? null : targetWattsAt(workout, position, ftp),
    power: state.powerWatts,
    heartRate: state.heartRate,
    cadence: state.cadenceRpm === undefined ? undefined : Math.round(state.cadenceRpm),
    trace: trace.current,
    running,
    elapsed,
    intensity,
    erg: erg ? { watts: ergWatts } : null,
    autoPaused,
    // Free ERG is ERG by definition.
    ergOn: erg || ergOn,
    grade,
    allOut,
    sprintGrade: allOut && ergOn ? sprintGrade : null,
    freeRide,
    finished: workoutDone && !ended,
    ended,
    totals: rideTotals(samples.current, hrSamples.current, cadenceSamples.current, ftp),
    startIn: autoStartOn && elapsed === 0 && state.connected.trainer ? startIn : null,
    autoStart: autoStartOn && elapsed === 0 && !!state.connected.trainer,
    extend: { kind: extendKind, minutes: extensionMinutes(extension), watts: extendWattsShown, block: blockTemplate.name },
    holding,
    powerAverage: running && recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : undefined,
    adaptive: adaptive && !ended ? { on: adaptOn } : null,
    adapt: adaptNotice(),
    fields: { pages: ridePages, overlay: pagesOf(fieldSets, "overlay"), page: fieldPage, values: fieldValues },
  };

  /** Turns ERG on (the target goes back to the trainer at the next tick) or off (a road at the grade). */
  const setErgMode = (on: boolean) => {
    ergOnRef.current = on;
    setErgOn(on);
    lastSentTarget.current = null;
    sprinting.current = null;
    if (!state.connected.trainer) return;
    if (!on) hub.setSimulationGrade(grade).catch((e) => setError(String(e)));
    else if (running) tick.current();
    else if (allOut) hub.setSimulationGrade(sprintGradeRef.current).catch((e) => setError(String(e)));
    else if (freeRide) hub.setSimulationGrade(gradeRef.current).catch((e) => setError(String(e)));
    else {
      const target = targetWattsAt(workout, position, ftp);
      if (target !== null) hub.setTargetPower(target).catch((e) => setError(String(e)));
    }
  };

  const changeGrade = (delta: number) => {
    // In a sprint with ERG on, this is the sprint grade, kept for every sprint after.
    if (ergOnRef.current && allOut) {
      const next = clampGrade(sprintGradeRef.current + delta);
      sprintGradeRef.current = next;
      setSprintGrade(next);
      writePref(SPRINT_GRADE_PREF, String(next));
      if (state.connected.trainer) hub.setSimulationGrade(next).catch((e) => setError(String(e)));
      sprinting.current = next;
      return;
    }
    const next = clampGrade(grade + delta);
    gradeRef.current = next;
    setGrade(next);
    // ERG off, or a free ride in the workout: the trainer is on the road, so the new grade goes now.
    if ((!ergOnRef.current || freeRide) && state.connected.trainer) {
      hub.setSimulationGrade(next).catch((e) => setError(String(e)));
      if (freeRide) sprinting.current = next;
    }
  };

  /** Moves the workout position; the ride clock keeps counting real time. */
  const jump = (to: number) => {
    offset.current += to - position;
    // Show the new interval now rather than at the next second.
    rerender();
    setNotice(null);
    tick.current();
  };

  /** Pages to step through: the ride's or the overlay's, whichever has more (each view wraps to its own). */
  const pageCount = Math.max(ridePages.length, data.fields.overlay.length);
  const stepPage = (step: unknown) => {
    if (step !== 1 && step !== -1) return;
    setFieldPage((p) => (p + step + pageCount) % pageCount);
  };
  // ← and → change page, unless typing somewhere or editing the fields.
  const stepPageRef = useRef(stepPage);
  stepPageRef.current = stepPage;
  useEffect(() => {
    if (pageCount < 2 || editingFields) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=slider], [role=radiogroup], [role=dialog]")) return;
      e.preventDefault();
      stepPageRef.current(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount, editingFields]);

  const controls: PlayerControls = {
    canPlay: !!state.connected.trainer,
    onPage: stepPage,
    onPlayPause: () => (running ? pause() : start()),
    onExtend: extend,
    onEnd: end,
    onExtendMinutes: (minutes) => setExtendMinutes(clampMinutes(minutes)),
    onExtendKind: (kind) => {
      setExtendKind(kind);
      writePref(EXTEND_KIND_PREF, kind);
    },
    onExtendBlock: (step) => {
      const at = BLOCKS.findIndex((t) => t.id === blockTemplate.id);
      const next = BLOCKS[(at + step + BLOCKS.length) % BLOCKS.length];
      setExtendBlock(next.id);
      writePref(EXTEND_BLOCK_PREF, next.id);
    },
    onHold: (delta) => {
      if (!current || !holding || ftp <= 0) return;
      const watts = clampErg((data.targetWatts ?? extendWattsShown) + delta * ERG_STEP);
      const index = current.index;
      setBaseWorkout((b) => ({
        ...b,
        segments: b.segments.map((seg, i) => (i === index && seg.kind === "steady" ? { ...seg, target: watts / ftp / (intensity / 100) } : seg)),
      }));
    },
    onExtendWatts: (watts) => setExtendWatts(clampErg(watts)),
    onSkip: () => {
      if (!current) return;
      jump(current.end);
    },
    // The previous interval's start, or this one's when it's the first. After the end, the last.
    onBack: () => {
      const back = current ? (all[current.index - 1] ?? current) : all[all.length - 1];
      if (back) jump(back.start);
    },
    // Targets change at once; the tick sends the new ERG target. The rider's steering, so adaptive keeps its hands off for now.
    onIntensity: (delta) => {
      steered.current = true;
      setIntensity((i) => Math.min(150, Math.max(50, i + delta)));
    },
    onAdaptUndo: () => {
      if (!adaptShown || adaptShown.change.kind !== "ease") return;
      setFactors(adaptShown.before);
      easeUndone.current = true;
      settleAdapt("undone");
    },
    onAdaptYes: () => {
      if (!adaptShown || adaptShown.change.kind !== "bump") return;
      setFactors(withFactor(adaptShown.before, adaptShown.change.reps, adaptShown.change.factor));
      settleAdapt("accepted");
    },
    onAdaptNo: () => {
      if (!adaptShown || adaptShown.change.kind !== "bump") return;
      bumpDeclined.current = true;
      settleAdapt("declined");
    },
    onAdaptive: (on) => {
      setAdaptOn(on);
      // Off puts every rep back as planned, and drops a question on screen.
      if (!on) {
        if (adaptShown) settleAdapt(adaptShown.change.kind === "ease" ? "undone" : "declined");
        setFactors(new Map());
      }
    },
    onErg: setErg,
    onErgMode: setErgMode,
    onGrade: changeGrade,
  };
  useEffect(() => {
    if (running) tick.current();
  }, [intensity, ftp, running, baseWorkout, factors]);

  return (
    // The ride page is an instrument beside Zwift, so it's dark whatever the system setting.
    <div className="min-h-screen">
      <Nav current="/ride" />
      <Page>
        <h1 className="sr-only">Ride</h1>
        {!supported && <Notice>This browser has no Web Bluetooth. Open the Lactic app to ride with your trainer.</Notice>}
        {error && <Notice tone="negative">{error}</Notice>}

        <div data-tour="ride-gear">
          <SensorPanel hub={hub} state={state} supported={supported} onError={setError} />
        </div>

        {elapsed === 0 && (
          <div data-tour="ride-pick">
            <RideNow
              source={source}
              planned={planned}
              plannedLabel={plannedLabel}
              library={library}
              levels={levels}
              saved={saved}
              customId={customId}
              starterId={starterId}
              favorites={favorites}
              canSave={canSave}
              importing={importing}
              onSource={pickSource}
              onLibrary={pickLibrary}
              onCustom={(entry) => ride("custom", entry.workout, entry.id)}
              onStarter={pickStarter}
              onFavorite={toggleFavorite}
              onNew={() => {
                ride("custom", blankWorkout(), null);
                setEditorOpen(true);
              }}
              onDelete={removeCustom}
              onFile={importZwo}
            />
          </div>
        )}

        {ended && (
          <div ref={endPanel} className="scroll-mt-4">
            <Panel title="Ride ended" meta={<span className="num">{formatTime(elapsed)}</span>}>
              <div className="space-y-4">
                <p className="text-[15px] text-muted">
                  {saveState === "saving"
                    ? "Saving the ride..."
                    : notice
                      ? notice
                      : !canSave
                        ? "Sign in to save rides."
                        : elapsed < 60
                          ? "Too short to save."
                          : "Not saved yet."}
                  {savedId && saveState === "saved" && (
                    <>
                      {" "}
                      <Link href={`/rides/${savedId}`} className="text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
                        See how it went
                      </Link>
                    </>
                  )}
                </p>
                {rampResult && <RampTestResult test="ramp" result={{ watts: rampResult.watts, best: rampResult.bestMinute }} current={initialFtp ?? ftp} guess={ftpGuess} onSet={setFtp} />}
                {twentyResult && <RampTestResult test="twentyMinute" result={twentyResult} current={initialFtp ?? ftp} guess={ftpGuess} onSet={setFtp} />}
                {canSave && !erg && saveState === "saved" && (
                  <FavoriteButton
                    on={(() => {
                      const key = ridden();
                      return key !== null && favorites.has(key);
                    })()}
                    name={workout.name}
                    label={ridden() ? "Favorite this workout" : "Save and favorite this workout"}
                    onToggle={favoriteRidden}
                  />
                )}
                {survey && <RideSurvey ride={{ appStartedAt: survey.appStartedAt }} name={survey.name} session={survey.session} />}
              </div>
            </Panel>
          </div>
        )}

        <div data-tour="ride-player">
          {editingFields && elapsed === 0 ? (
            <FieldEditor
              initial={fieldSets}
              ftp={ftp}
              weightKg={weightKg}
              thresholdHr={thresholdHr}
              pluginFields={pluginFieldOptions(plugins)}
              saving={savingFields}
              chart={<WorkoutChart workout={shown} ftp={ftp} position={0} trace={[]} to={workoutDuration(shown)} className="h-36 w-full text-ink" />}
              onCancel={() => setEditingFields(false)}
              onDone={async (ride, keepCopy) => {
                setSavingFields(true);
                const result = canSave ? await saveRideFields({ ride, keepCopy }) : { ok: true, message: "" };
                setSavingFields(false);
                if (!result.ok) return setError(`Couldn't save the ride fields: ${result.message}`);
                setFieldSets(ride);
                setFieldPage(0);
                setEditingFields(false);
              }}
            />
          ) : (
          <PlayerView
            data={data}
            controls={controls}
            dock={
              <button className={`${button.secondary} w-full`} onClick={end}>
                End ride
              </button>
            }
            extra={
              <>
                {/* Ride actions, quieter than the controls: End once a ride is under way, Save again if saving failed, Reset once one started. */}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {elapsed > 0 && !ended && !data.finished && (
                    <button className={`${button.secondary} max-md:hidden`} onClick={end}>
                      End ride
                    </button>
                  )}
                  {ended && canSave && elapsed >= 60 && saveState !== "saved" && (
                    <button className={button.secondary} disabled={saveState !== "idle"} onClick={save}>
                      {saveState === "saving" ? "Saving..." : "Save ride"}
                    </button>
                  )}
                  {/* Fields are only customized before a ride, never mid-ride (review U6). */}
                  {elapsed === 0 && !running && (
                    <button className={button.ghost} onClick={() => setEditingFields(true)}>
                      Customize fields
                    </button>
                  )}
                  {pip.supported && !ended && (
                    <button className={button.ghost} onClick={() => (pip.pip ? pip.close() : openOverlay())}>
                      {pip.pip ? "Close overlay" : "Open overlay"}
                    </button>
                  )}
                  {elapsed > 0 && (
                    <button
                      className={button.ghost}
                      onClick={() => {
                        if (unsaved && !window.confirm("Reset this ride? It hasn't been saved.")) return;
                        reset();
                      }}
                    >
                      {ended ? "New ride" : "Reset"}
                    </button>
                  )}
                </div>
                <p className="num text-sm text-muted">{/trainer/i.test(state.trainerStatus) ? state.trainerStatus : `Trainer: ${state.trainerStatus}`}</p>
              </>
            }
          />
          )}
        </div>

        {!erg && (
          <div data-tour="ride-editor">
            <WorkoutEditor
              key={loads}
              workout={baseWorkout}
              ftp={ftp}
              intensity={intensity}
              position={position}
              edited={edited}
              open={editorOpen}
              onToggle={() => setEditorOpen((o) => !o)}
              canSave={canSave}
              savedId={customId}
              onChange={editWorkout}
              onSaved={setCustomId}
            />
          </div>
        )}

        {!erg && today && !running && elapsed === 0 && (
          <div data-tour="ride-outside">
            <SendToKaroo workout={workout} today={today} />
          </div>
        )}

        <div data-tour="ride-setup">
          <Panel
            // Collapsed, the title row's bottom margin stands in for the padding.
            className={setupOpen ? undefined : "pb-1"}
            title={
              <button type="button" onClick={() => setSetupOpen((o) => !o)} aria-expanded={setupOpen} className="flex items-center gap-2 hover:text-muted">
                <span aria-hidden className={`inline-block text-xs transition-transform ${setupOpen ? "rotate-90" : ""}`}>
                  ▶
                </span>
                Setup
              </button>
            }
            meta={
              <span className="num">
                {state.powerSource === "trainer" ? "Trainer power" : "Power meter"} · FTP {ftp} W{autoStartOn ? " · starts when you pedal" : ""}{pip.supported && overlayOnStart ? " · overlay opens on start" : ""}
              </span>
            }
          >
            {setupOpen && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">Start</h3>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={autoStartOn} onChange={(e) => toggleAutoStart(e.target.checked)} className="size-4 accent-[var(--ink)]" />
                      Start when I pedal
                    </label>
                    <p className="text-sm text-muted">
                      With a ride picked and the trainer connected, a few seconds of pedaling starts it. Stop pedaling and it pauses; pedal again and it
                      picks up.
                    </p>
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">Overlay</h3>
                    {pip.supported ? (
                      <>
                        <p className="text-sm text-muted">
                          A small window with the interval, targets and what&apos;s next that stays on top of whatever else you have open: Zwift, a video, a browser. Drag it bigger, or use its shrink and enlarge buttons.{" "}
                          {FULL_SCREEN_NOTE[pip.fullScreen]}
                        </p>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={overlayOnStart} onChange={(e) => toggleOverlayOnStart(e.target.checked)} className="size-4 accent-[var(--ink)]" />
                          Open it when I start
                        </label>
                        {overlayOnStart && autoStartOn && pip.needsClick && (
                          <p className="text-sm text-muted">Chrome only opens it from a click, so it opens when you click Start; if pedaling starts the ride, open it with Open overlay.</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted">
                        {isPhone()
                          ? "On iPhone the ride screen is the overlay: iOS doesn't let apps float a window over other apps. Ride Zwift on your computer and keep this screen in view."
                          : isDemo
                          ? "In the app, a small window with the interval, targets and what's next stays on top of whatever else you have open: Zwift, a video, a browser."
                          : "The overlay needs Chrome 116 or later on a desktop."}
                      </p>
                    )}
                  </section>

                  <section className="space-y-3">
                    <h3 className="text-sm font-medium">Power source</h3>
                    <Segmented
                      label="Power source"
                      options={[
                        { value: "trainer" as const, label: "Trainer" },
                        { value: "powerMeter" as const, label: "Power meter" },
                      ]}
                      value={state.powerSource}
                      onChange={pickPowerSource}
                    />
                    <p className="text-sm text-muted">
                      {state.powerSource === "trainer"
                        ? "Power and cadence come from the trainer."
                        : state.connected.powerMeter
                          ? "Power and cadence come from the power meter, and ERG targets are matched to it."
                          : "Connect the power meter to use it. Until then, the trainer's power counts."}
                    </p>
                    {state.powerSource === "powerMeter" && state.connected.powerMeter && state.connected.trainer && (
                      <p className="num text-sm text-muted">
                        Trainer {state.trainerWatts ?? "–"} W · power meter {state.meterWatts ?? "–"} W
                        {state.matchRatio !== undefined && state.matchRatio !== 1 && ` · trainer reads ${state.matchRatio > 1 ? "+" : ""}${Math.round((state.matchRatio - 1) * 1000) / 10}%`}
                      </p>
                    )}
                  </section>

                  <section className="space-y-3 text-sm">
                    <h3 className="font-medium">FTP{initialFtp ? <span className="font-normal text-muted"> · from Settings</span> : null}</h3>
                    <label className="flex items-center gap-2">
                      <input type="number" value={ftp} onChange={(e) => setFtp(Number(e.target.value) || 0)} className={`${input} num w-24`} aria-label="FTP" />
                      <span className="text-muted">W</span>
                    </label>
                    {initialFtp && ftp !== initialFtp ? (
                      <p className="text-muted">
                        This ride only; Settings keeps <span className="num text-ink">{initialFtp} W</span>.{" "}
                        <button type="button" onClick={() => setFtp(initialFtp)} className="text-ink underline underline-offset-4">
                          Reset
                        </button>
                      </p>
                    ) : (
                      <p className="text-muted">Changes here apply to this ride only.</p>
                    )}
                  </section>
                </div>
                <p className="text-sm text-muted">
                  Riding with Zwift open: in Zwift, pair your trainer for power, cadence and heart rate only, and leave &quot;Controllable&quot;
                  unpaired so Lactic keeps ERG control.
                </p>
              </div>
            )}
          </Panel>
        </div>
        {pip.pip && <OverlayPortal pip={pip.pip} data={data} controls={controls} onResize={resizeOverlay} />}
        {isDesktop && !isPhone() && <RemoteHost data={data} controls={controls} />}
      </Page>
    </div>
  );
}

/** Factors with `reps` set to `factor`. */
function withFactor(factors: ReadonlyMap<number, number>, reps: number[], factor: number): ReadonlyMap<number, number> {
  const next = new Map(factors);
  for (const r of reps) next.set(r, factor);
  return next;
}
