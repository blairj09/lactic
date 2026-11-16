"use client";

import { MAX_LEVEL, MIN_LEVEL, STARTING_LEVELS, ZONES, ZONE_LABELS, buildSession, isRampTest, rampTest, type Levels, type Session, type Zone } from "@/lib/engine/library";
import { templatesFor } from "@/lib/engine/templates";
import { plannedStress, workoutDuration } from "@/lib/engine/workout";
import { customKey, customLibraryWorkout, libraryKey, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout, type LibraryCategory, type LibraryWorkout } from "@/lib/engine/workout-library";
import type { Workout } from "@/lib/engine/workout";
import type { CustomWorkout } from "@/lib/custom-workouts";
import FavoriteButton from "@/components/favorite-button";
import { WorkoutRow, WorkoutSheet } from "@/components/workout-list";
import { useEffect, useState } from "react";
import { Panel, Segmented, button, input } from "@/components/ui";
import Select from "@/components/select";
import { formatTime } from "./player";
import HeadUnitAuto from "~/ride/head-unit-switch";

/**
 * What the player is set up to ride: the plan's session, a generated workout, a starter library
 * workout, one of My workouts, free ERG, or a head unit ride (another app drives the trainer).
 */
export type RideSource = "planned" | "library" | "starter" | "custom" | "erg" | "headUnit";

/** My workouts' shelves: the starter library, your saved workouts, and favorites from both. */
type Shelf = "library" | "saved" | "favorites";

/** The ways to pick a ride: the day's session, a workout (library or your own), a free ride, or a head unit over another app. */
type Mode = "planned" | "pick" | "erg" | "headUnit";

export type LibraryKind = Zone | "rampTest";

export interface LibraryChoice {
  kind: LibraryKind;
  minutes: number;
  /** Levels above (or below) where you are in the zone. */
  shift: number;
  /** The workout structure (templates.ts); the zone's classic one when not set. */
  template?: string;
}

export const DEFAULT_LIBRARY: LibraryChoice = { kind: "endurance", minutes: 60, shift: 0 };

const KINDS: { value: LibraryKind; label: string }[] = [...ZONES.map((z) => ({ value: z as LibraryKind, label: ZONE_LABELS[z] })), { value: "rampTest", label: "FTP test" }];
const MINUTES = [30, 45, 60, 75, 90, 120];

/** The engine's workout for a library choice, at your level in the zone plus the shift. */
export function librarySession(choice: LibraryChoice, levels: Levels): Session {
  if (choice.kind === "rampTest") return rampTest();
  const level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, (levels[choice.kind] ?? STARTING_LEVELS[choice.kind]) + choice.shift));
  return buildSession(choice.kind, level, choice.minutes * 60, { template: choice.template });
}

/** A style's name without its type ("Threshold with hard starts" → "Hard starts"), since the Type menu says it. */
export function styleName(name: string, kind: LibraryKind): string {
  if (kind === "rampTest") return name;
  const label = ZONE_LABELS[kind];
  if (!name.toLowerCase().startsWith(`${label.toLowerCase()} `)) return name;
  const rest = name.slice(label.length + 1).replace(/^with /, "");
  const short = rest.charAt(0).toUpperCase() + rest.slice(1);
  // "Endurance with tempo" would read as just "Tempo", another type: keep the full name.
  return (Object.values(ZONE_LABELS) as string[]).includes(short) ? name : short;
}

/** The Length menu entry a workout of `seconds` falls under: the nearest one, so each workout shows under one length. */
export function lengthFor(seconds: number): number {
  const m = seconds / 60;
  return MINUTES.reduce((best, x) => (Math.abs(x - m) < Math.abs(best - m) ? x : best), MINUTES[0]);
}

/** A workout that fits the Type, Length and Level menus, and what picking it loads. */
export interface Match {
  key: string;
  name: string;
  workout: Workout;
  duration: number;
  stress: number;
  /** Unset for recovery spins and tests, where levels don't move. */
  level?: number;
  pick: { library: LibraryChoice } | { starter: LibraryWorkout } | { custom: CustomWorkout };
  /** One of My workouts. */
  saved?: true;
}

/**
 * Every workout that fits the menus: the engine's styles built at your level (plus the Level shift),
 * starter library workouts and My workouts of the type whose length is nearest the one picked. Ones
 * closest to the level come first. A style the engine can't fit in the length (it would fall back to
 * another type or style) is left out, so nothing listed is a different workout from what you asked for.
 */
export function matchingWorkouts(choice: LibraryChoice, levels: Levels, saved: CustomWorkout[]): Match[] {
  const kind = choice.kind;
  const tests = kind === "rampTest";
  const fits = (seconds: number) => tests || lengthFor(seconds) === choice.minutes;
  const leveled = !tests && kind !== "recovery";
  const target = tests ? 0 : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, (levels[kind] ?? STARTING_LEVELS[kind]) + choice.shift));

  const built: Match[] = [];
  if (!tests) {
    const styles: (string | undefined)[] =
      kind === "recovery" ? [undefined] : [...(kind === "endurance" ? [undefined] : []), ...templatesFor(kind).map((t) => t.id as string)];
    for (const template of styles) {
      const s = librarySession({ ...choice, template }, levels);
      if (s.zone !== kind || (s.template ?? undefined) !== template || Math.abs(s.duration - choice.minutes * 60) > 60) continue;
      if (built.some((b) => b.name === s.workout.name)) continue;
      built.push({ key: `built:${template ?? "steady"}`, name: s.workout.name, workout: s.workout, duration: s.duration, stress: s.stress, level: leveled ? s.level : undefined, pick: { library: { ...choice, template } } });
    }
  }
  const starters: Match[] = WORKOUT_LIBRARY.filter((w) => (tests ? w.category === "tests" : w.zone === kind && w.category !== "tests") && fits(w.duration)).map((w) => ({
    key: libraryKey(w.id),
    name: w.workout.name,
    workout: w.workout,
    duration: w.duration,
    stress: w.stress,
    level: leveled ? w.level : undefined,
    pick: { starter: w },
  }));
  const mine: Match[] = tests
    ? []
    : saved.flatMap((c) => {
        const w = customLibraryWorkout(c.id, c.workout);
        if (!w || w.zone !== kind || !fits(w.duration)) return [];
        return [{ key: customKey(c.id), name: c.workout.name, workout: c.workout, duration: w.duration, stress: w.stress, level: leveled ? w.level : undefined, pick: { custom: c }, saved: true as const }];
      });
  const gap = (m: Match) => (m.level === undefined ? 0 : Math.abs(m.level - target));
  // A stable sort keeps the engine's styles ahead of library ones at the same distance.
  return [...built, ...starters, ...mine].sort((a, b) => gap(a) - gap(b));
}

/** A small label above a menu. */
function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <span className="block text-xs text-faint">{label}</span>
      {children}
    </div>
  );
}

/** Level − / +: one step easier or harder than where you are in the zone. */
function LevelStepper({ level, onChange }: { level: number; onChange: (delta: -1 | 1) => void }) {
  const step = "h-full w-9 text-lg text-muted transition-colors hover:text-ink disabled:opacity-40";
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-md border border-control bg-surface" role="group" aria-label="Level">
      <button type="button" className={step} disabled={level <= MIN_LEVEL} onClick={() => onChange(-1)} aria-label="Easier">
        −
      </button>
      <span className="num flex h-full items-center whitespace-nowrap border-x border-control px-2.5 text-sm" aria-live="polite">
        Level {level}
      </span>
      <button type="button" className={step} disabled={level >= MAX_LEVEL} onClick={() => onChange(1)} aria-label="Harder">
        +
      </button>
    </div>
  );
}

const sessionLine = (s: Session, showLevel: boolean) => `${formatTime(s.duration)} · TSS ${Math.round(s.stress)}${showLevel ? ` · level ${s.level}` : ""}`;

/**
 * What to ride: the day's planned session, a workout (from the engine's library or My workouts,
 * where a .zwo, .erg or .mrc file can be imported), or a free ride at one ERG target. Picking loads it into the
 * player and the workout editor. Shown only before a ride starts.
 */
export default function RideNow({
  source,
  planned,
  plannedLabel,
  library,
  levels,
  saved,
  customId,
  starterId,
  favorites,
  canSave,
  importing,
  onSource,
  onLibrary,
  onCustom,
  onStarter,
  onFavorite,
  onNew,
  onDelete,
  onFile,
  ftp,
}: {
  source: RideSource;
  planned: Session | null;
  plannedLabel: string;
  library: LibraryChoice;
  levels: Levels;
  /** My workouts, and which of them is loaded. */
  saved: CustomWorkout[];
  customId: string | null;
  /** The starter library workout loaded. */
  starterId: string | null;
  /** Favorite keys (`library:<id>`, `custom:<id>`). */
  favorites: ReadonlySet<string>;
  canSave: boolean;
  /** A workout file is being saved into My workouts. */
  importing: boolean;
  onSource: (source: RideSource) => void;
  onLibrary: (choice: LibraryChoice) => void;
  onCustom: (saved: CustomWorkout) => void;
  onStarter: (entry: LibraryWorkout) => void;
  onFavorite: (key: string, on: boolean) => void;
  /** Starts a new workout from a blank warmup and cooldown. */
  onNew: () => void;
  onDelete: (saved: CustomWorkout) => void;
  /** Imports a workout file (.zwo, .erg or .mrc) into My workouts and loads it. */
  onFile: (file: File) => void;
  /** Watts for the workout sheet's targets. */
  ftp?: number;
}) {
  const mode: Mode = source === "planned" ? "planned" : source === "erg" ? "erg" : source === "headUnit" ? "headUnit" : "pick";
  const modes: { value: Mode; label: string }[] = [
    ...(planned ? [{ value: "planned" as const, label: plannedLabel }] : []),
    { value: "pick", label: "Pick a workout" },
    { value: "erg", label: "Free ride" },
    { value: "headUnit", label: "Head unit" },
  ];
  // The menus here; picking a workout from the list below loads it (and a style of the engine's sets `library`).
  const [filters, setFilters] = useState<LibraryChoice>(library);
  // Library and my workouts open in place of the menus.
  const [browsing, setBrowsing] = useState(source === "custom" || source === "starter");
  const [showAll, setShowAll] = useState(false);
  const matches = matchingWorkouts(filters, levels, saved);
  const leveled = filters.kind !== "rampTest" && filters.kind !== "recovery";
  const level = leveled ? Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, (levels[filters.kind as Zone] ?? STARTING_LEVELS[filters.kind as Zone]) + filters.shift)) : 0;
  const loadedName = source === "library" ? librarySession(library, levels).workout.name : null;
  const isLoaded = (m: Match) =>
    "library" in m.pick ? m.name === loadedName : "starter" in m.pick ? source === "starter" && m.pick.starter.id === starterId : source === "custom" && m.pick.custom.id === customId;

  const load = (m: Match) => {
    if ("library" in m.pick) onLibrary(m.pick.library);
    else if ("starter" in m.pick) onStarter(m.pick.starter);
    else onCustom(m.pick.custom);
  };
  /** New menus: the list follows, and the best match loads so the player below matches them. */
  const filter = (next: LibraryChoice) => {
    setFilters(next);
    setShowAll(false);
    const first = matchingWorkouts(next, levels, saved)[0];
    if (first) load(first);
  };
  // Ride opens on Pick a workout with the engine's default: keep the menus in step with what's loaded.
  useEffect(() => setFilters((f) => (source === "library" ? { ...library, shift: library.shift } : f)), [library, source]);

  const LIMIT = 5;
  const shown = showAll ? matches : matches.slice(0, LIMIT);
  // Nothing fits: point at the nearest length that has something.
  const nearest = matches.length
    ? null
    : (MINUTES.filter((m) => m !== filters.minutes && matchingWorkouts({ ...filters, minutes: m }, levels, saved).length).sort((a, b) => Math.abs(a - filters.minutes) - Math.abs(b - filters.minutes))[0] ?? null);
  const kindLabel = KINDS.find((k) => k.value === filters.kind)?.label ?? "";
  const stepper = <LevelStepper level={level} onChange={(d) => filter({ ...filters, shift: filters.shift + d })} />;
  const shelfOpen = browsing && (source === "custom" || source === "starter");

  return (
    <Panel>
      <div className="space-y-5">
        <Segmented
          label="What to ride"
          options={modes}
          value={mode}
          onChange={(m) => {
            if (m === "pick") {
              setBrowsing(false);
              if (matches[0]) return load(matches[0]);
            }
            onSource(m === "planned" ? "planned" : m === "erg" ? "erg" : m === "headUnit" ? "headUnit" : "library");
          }}
        />

        {source === "planned" && planned && (
          <p className="text-sm text-muted">
            <span className="text-[15px] font-medium text-ink">{planned.workout.name}</span>
            <span className="num"> · {sessionLine(planned, planned.zone !== "recovery")}</span>
          </p>
        )}
        {source === "planned" && planned && isRampTest(planned.workout) && <RampTestHint />}

        {mode === "pick" && !shelfOpen && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2 sm:gap-3">
              <Field label="Type" className="min-w-0 flex-1 sm:flex-none">
                <Select
                  aria-label="Workout type"
                  value={filters.kind}
                  onChange={(kind) => filter({ ...filters, kind: kind as LibraryKind, shift: 0, template: undefined })}
                  className={`${input} w-full sm:w-40`}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {filters.kind !== "rampTest" && (
                <Field label="Length" className="min-w-0 flex-1 sm:flex-none">
                  <Select aria-label="Length" value={filters.minutes} onChange={(m) => filter({ ...filters, minutes: Number(m) })} className={`${input} w-full sm:w-28`}>
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {leveled && <span className="hidden sm:block">{stepper}</span>}
            </div>
            {leveled && (
              <div className="flex items-center justify-between gap-3 sm:hidden">
                <p className="text-sm text-muted">{matches.length === 1 ? "1 workout" : `${matches.length} workouts`}</p>
                {stepper}
              </div>
            )}

            {matches.length > 0 ? (
              <ul className="divide-y divide-rule border-y border-rule">
                {shown.map((m) => {
                  const loaded = isLoaded(m);
                  return (
                    <WorkoutRow
                      key={m.key}
                      name={m.name}
                      line={`${m.saved ? "Saved · " : ""}${workoutLine(m.duration, m.stress, m.level)}`}
                      workout={m.workout}
                      current={loaded}
                      onOpen={() => load(m)}
                      actions={loaded ? <span className="text-sm text-accent">✓ Loaded</span> : undefined}
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                No {kindLabel.toLowerCase()} workouts at {filters.minutes} min.{" "}
                {nearest && (
                  <button type="button" className={button.ghost} onClick={() => filter({ ...filters, minutes: nearest })}>
                    Try {nearest} min
                  </button>
                )}
              </p>
            )}
            {matches.length > LIMIT && (
              <button type="button" className={button.ghost} onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${matches.length}`}
              </button>
            )}
            {filters.kind === "rampTest" && source === "starter" && libraryWorkout(starterId)?.id === "test-ramp" && <RampTestHint />}
            <div>
              <button
                type="button"
                className={button.ghost}
                onClick={() => {
                  setBrowsing(true);
                  onSource("custom");
                }}
              >
                Library and my workouts
              </button>
            </div>
          </div>
        )}

        {shelfOpen && (
          <div className="-mt-1 flex flex-wrap gap-x-5">
            {/* The switcher above scrolls away in a long list, so the way back to the plan stays in reach. */}
            {planned && (
              <button type="button" className={button.ghost} onClick={() => onSource("planned")}>
                ‹ Back to {plannedLabel.charAt(0).toLowerCase() + plannedLabel.slice(1)}
              </button>
            )}
            <button type="button" className={button.ghost} onClick={() => setBrowsing(false)}>
              ‹ Back to matches
            </button>
          </div>
        )}

        {shelfOpen && (
          <MyWorkouts
            saved={saved}
            customId={source === "custom" ? customId : null}
            starterId={source === "starter" ? starterId : null}
            favorites={favorites}
            canSave={canSave}
            importing={importing}
            onCustom={onCustom}
            onStarter={onStarter}
            onFavorite={onFavorite}
            onNew={onNew}
            onDelete={onDelete}
            onFile={onFile}
            ftp={ftp}
          />
        )}

        {source === "erg" && (
          <p className="text-sm text-muted">One ERG target you change as you go. The ride runs until you pause and save it.</p>
        )}

        {source === "headUnit" && (
          <div>
            <p className="text-[15px] font-medium text-ink">Your fields over Zwift, Rouvy or any app</p>
            <p className="text-sm text-muted">Lactic reads your sensors and leaves the trainer to the other app.</p>
            <HeadUnitAuto />
          </div>
        )}
      </div>
    </Panel>
  );
}

/** How a ramp test works, for a rider who may never have done one (often their first workout). */
function RampTestHint() {
  return <p className="-mt-2 text-sm text-muted">Ride until you can&apos;t hold the target, then end the ride. Your best minute sets your FTP.</p>;
}

const workoutLine = (duration: number, stress: number, level?: number) =>
  `${formatTime(duration)} · TSS ${Math.round(stress)}${level !== undefined ? ` · level ${level}` : ""}`;

/** The levels a library workout shows: none for recovery spins and tests, where levels don't move. */
const shownLevel = (w: LibraryWorkout) => (w.category === "recovery" || w.category === "tests" ? undefined : w.level);

/**
 * My workouts: the starter library by type, the workouts you saved or imported, and your favorites
 * from both. Load puts one in the player; the heart adds it to favorites, which the plan prefers.
 */
function MyWorkouts({
  saved,
  customId,
  starterId,
  favorites,
  canSave,
  importing,
  onCustom,
  onStarter,
  onFavorite,
  onNew,
  onDelete,
  onFile,
  ftp,
}: {
  saved: CustomWorkout[];
  customId: string | null;
  starterId: string | null;
  favorites: ReadonlySet<string>;
  canSave: boolean;
  importing: boolean;
  onCustom: (saved: CustomWorkout) => void;
  onStarter: (entry: LibraryWorkout) => void;
  onFavorite: (key: string, on: boolean) => void;
  onNew: () => void;
  onDelete: (saved: CustomWorkout) => void;
  onFile: (file: File) => void;
  /** Watts for the workout sheet's targets. */
  ftp?: number;
}) {
  const [shelf, setShelf] = useState<Shelf>(saved.length && !starterId ? "saved" : "library");
  const [category, setCategory] = useState<LibraryCategory | "all">(() => libraryWorkout(starterId)?.category ?? "all");
  const shelves: { value: Shelf; label: string }[] = [
    { value: "library", label: "Library" },
    { value: "saved", label: `Saved${saved.length ? ` (${saved.length})` : ""}` },
    ...(canSave ? [{ value: "favorites" as const, label: `Favorites${favorites.size ? ` (${favorites.size})` : ""}` }] : []),
  ];

  const heart = (key: string, name: string) =>
    canSave ? <FavoriteButton on={favorites.has(key)} name={name} onToggle={() => onFavorite(key, !favorites.has(key))} /> : null;

  /** The workout open in its sheet: a starter library one or one of yours. */
  const [open, setOpen] = useState<{ library: LibraryWorkout } | { saved: CustomWorkout } | null>(null);

  const libraryLine = (w: LibraryWorkout) => `${category === "all" || shelf === "favorites" ? `${LIBRARY_CATEGORY_LABELS[w.category]} · ` : ""}${workoutLine(w.duration, w.stress, shownLevel(w))}`;
  const savedLine = (s: CustomWorkout) => workoutLine(workoutDuration(s.workout), plannedStress(s.workout));

  const libraryRow = (w: LibraryWorkout) => (
    <WorkoutRow
      key={w.id}
      name={w.workout.name}
      line={libraryLine(w)}
      workout={w.workout}
      current={w.id === starterId}
      onOpen={() => setOpen({ library: w })}
      actions={
        <>
          {heart(libraryKey(w.id), w.workout.name)}
          <button className={button.small} disabled={w.id === starterId} onClick={() => onStarter(w)}>
            {w.id === starterId ? "Loaded" : "Load"}
          </button>
        </>
      }
    />
  );

  const savedRow = (s: CustomWorkout, removable: boolean) => (
    <WorkoutRow
      key={s.id}
      name={s.workout.name}
      line={savedLine(s)}
      workout={s.workout}
      current={s.id === customId}
      onOpen={() => setOpen({ saved: s })}
      actions={
        <>
          {heart(customKey(s.id), s.workout.name)}
          <button className={button.small} disabled={s.id === customId} onClick={() => onCustom(s)}>
            {s.id === customId ? "Loaded" : "Load"}
          </button>
          {removable && (
            <button className={button.ghost} onClick={() => onDelete(s)} aria-label={`Delete ${s.workout.name}`}>
              Delete
            </button>
          )}
        </>
      }
    />
  );

  const sheet = (() => {
    if (!open) return null;
    const close = () => setOpen(null);
    if ("library" in open) {
      const w = open.library;
      const loaded = w.id === starterId;
      return (
        <WorkoutSheet name={w.workout.name} line={`${LIBRARY_CATEGORY_LABELS[w.category]} · ${workoutLine(w.duration, w.stress, shownLevel(w))}`} workout={w.workout} description={w.description} ftp={ftp} onClose={close}>
          <button className={button.primary} disabled={loaded} onClick={() => (onStarter(w), close())}>
            {loaded ? "Loaded" : "Load"}
          </button>
          {heart(libraryKey(w.id), w.workout.name)}
        </WorkoutSheet>
      );
    }
    const s = open.saved;
    const loaded = s.id === customId;
    return (
      <WorkoutSheet name={s.workout.name} line={savedLine(s)} workout={s.workout} ftp={ftp} onClose={close}>
        <button className={button.primary} disabled={loaded} onClick={() => (onCustom(s), close())}>
          {loaded ? "Loaded" : "Load"}
        </button>
        {heart(customKey(s.id), s.workout.name)}
      </WorkoutSheet>
    );
  })();

  const shown = category === "all" ? WORKOUT_LIBRARY : WORKOUT_LIBRARY.filter((w) => w.category === category);
  // Favorites in the order you added them, newest first.
  const favoriteRows = [...favorites].flatMap((key) => {
    if (key.startsWith("library:")) {
      const w = libraryWorkout(key.slice(8));
      return w ? [libraryRow(w)] : [];
    }
    const s = saved.find((x) => customKey(x.id) === key);
    return s ? [savedRow(s, false)] : [];
  });

  return (
    <div className="space-y-4">
      {sheet}
      <Segmented label="My workouts" options={shelves} value={shelf} onChange={setShelf} />

      {shelf === "library" && (
        <div className="space-y-3">
          <Select aria-label="Library type" value={category} onChange={(c) => setCategory(c as LibraryCategory | "all")} className={`${input} w-full sm:w-48`}>
            {(["all", ...LIBRARY_CATEGORIES] as const).map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All types" : LIBRARY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <ul className="max-h-[32rem] divide-y divide-rule overflow-y-auto border-y border-rule">{shown.map(libraryRow)}</ul>
        </div>
      )}

      {shelf === "favorites" &&
        (favoriteRows.length ? (
          <ul className="divide-y divide-rule border-y border-rule">{favoriteRows}</ul>
        ) : (
          <p className="text-sm text-muted">No favorites yet. Tap the heart on a workout you like, here or after a ride. The plan picks your favorites when they fit a day.</p>
        ))}

      {shelf === "saved" && (
        <div className="space-y-4">
          {saved.length > 0 ? (
            <ul className="divide-y divide-rule border-y border-rule">{saved.map((s) => savedRow(s, true))}</ul>
          ) : (
            <p className="text-sm text-muted">
              {canSave ? "Nothing saved yet. Build one, import a workout file (.zwo, .erg or .mrc), or save any workout from the editor." : "Build one in the editor, or import a workout file (.zwo, .erg or .mrc)."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className={button.secondary} onClick={onNew}>
              New workout
            </button>
            <label className={`${button.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-ink ${importing ? "pointer-events-none opacity-50" : ""}`}>
              {importing ? "Importing..." : "Import workout file"}
              <input
                type="file"
                accept=".zwo,.erg,.mrc"
                className="sr-only"
                disabled={importing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onFile(file);
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
