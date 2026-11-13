"use client";

import { MAX_LEVEL, MIN_LEVEL, STARTING_LEVELS, ZONES, ZONE_LABELS, buildSession, rampTest, type Levels, type Session, type Zone } from "@/lib/engine/library";
import { templateById, templatesFor } from "@/lib/engine/templates";
import { plannedStress, workoutDuration } from "@/lib/engine/workout";
import { customKey, libraryKey, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout, type LibraryCategory, type LibraryWorkout } from "@/lib/engine/workout-library";
import type { CustomWorkout } from "@/lib/custom-workouts";
import FavoriteButton from "@/components/favorite-button";
import { useState } from "react";
import { Panel, Segmented, button, input } from "@/components/ui";
import Select from "@/components/select";
import { formatTime } from "./player";
import { canWatchApps, useHeadUnitAuto } from "~/ride/head-unit-auto";

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

const KINDS: { value: LibraryKind; label: string }[] = [...ZONES.map((z) => ({ value: z as LibraryKind, label: ZONE_LABELS[z] })), { value: "rampTest", label: "Ramp test" }];
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
}) {
  const mode: Mode = source === "planned" ? "planned" : source === "erg" ? "erg" : source === "headUnit" ? "headUnit" : "pick";
  const modes: { value: Mode; label: string }[] = [
    ...(planned ? [{ value: "planned" as const, label: plannedLabel }] : []),
    { value: "pick", label: "Pick a workout" },
    { value: "erg", label: "Free ride" },
    { value: "headUnit", label: "Head unit" },
  ];
  const session = librarySession(library, levels);
  const leveled = library.kind !== "rampTest" && library.kind !== "recovery";
  // Structures for the zone; endurance also rides steady, with no structure.
  const structures =
    library.kind === "rampTest" || library.kind === "recovery"
      ? []
      : [...(library.kind === "endurance" ? [{ id: undefined, name: "Steady" }] : []), ...templatesFor(library.kind).map((t) => ({ id: t.id as string | undefined, name: t.name }))];
  const picked = templateById(session.template);
  const style = library.template ?? (library.kind === "endurance" ? undefined : `${library.kind}-intervals`);
  const stepper = <LevelStepper level={session.level} onChange={(d) => onLibrary({ ...library, shift: library.shift + d })} />;
  const styleSelect = structures.length > 1 && (
    <Select
      aria-label="Style"
      value={style ?? "steady"}
      onChange={(id) => onLibrary({ ...library, template: id === "steady" ? undefined : id })}
      className={`${input} w-full sm:w-48`}
    >
      {structures.map((t) => (
        <option key={t.id ?? "steady"} value={t.id ?? "steady"}>
          {styleName(t.name, library.kind)}
        </option>
      ))}
    </Select>
  );
  const shelfOpen = source === "custom" || source === "starter";

  return (
    <Panel>
      <div className="space-y-5">
        <Segmented
          label="What to ride"
          options={modes}
          value={mode}
          onChange={(m) => onSource(m === "planned" ? "planned" : m === "erg" ? "erg" : m === "headUnit" ? "headUnit" : "library")}
        />

        {source === "planned" && planned && (
          <p className="text-sm text-muted">
            <span className="text-[15px] font-medium text-ink">{planned.workout.name}</span>
            <span className="num"> · {sessionLine(planned, planned.zone !== "recovery")}</span>
          </p>
        )}

        {source === "library" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
              <Field label="Type">
                <Select
                  aria-label="Workout type"
                  value={library.kind}
                  onChange={(kind) => onLibrary({ ...library, kind: kind as LibraryKind, shift: 0, template: undefined })}
                  className={`${input} w-full sm:w-40`}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {library.kind !== "rampTest" && (
                <Field label="Length" className="sm:order-2">
                  <Select
                    aria-label="Length"
                    value={library.minutes}
                    onChange={(m) => onLibrary({ ...library, minutes: Number(m) })}
                    className={`${input} w-full sm:w-28`}
                  >
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {structures.length > 1 && (
                <Field label="Style" className="col-span-2 sm:order-1">
                  {styleSelect}
                </Field>
              )}
              {leveled && <span className="hidden sm:order-3 sm:block">{stepper}</span>}
            </div>
            {/* The player below shows the workout's name, so this says only how long, how hard, and what it's for. */}
            <div className="flex items-center justify-between gap-3">
              <p className="num text-sm text-muted">{sessionLine(session, false)}</p>
              {leveled && <span className="sm:hidden">{stepper}</span>}
            </div>
            {picked && <p className="-mt-2 text-sm text-muted">{picked.description}</p>}
            <button type="button" className={button.ghost} onClick={() => onSource("custom")}>
              Library and my workouts
            </button>
          </div>
        )}

        {shelfOpen && (
          <button type="button" className={`${button.ghost} -mt-1`} onClick={() => onSource("library")}>
            Back to building a workout
          </button>
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

  const libraryRow = (w: LibraryWorkout) => (
    <li key={w.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] ${w.id === starterId ? "font-medium" : ""}`}>{w.workout.name}</p>
        <p className="num text-sm text-muted">
          {LIBRARY_CATEGORY_LABELS[w.category]} · {workoutLine(w.duration, w.stress, shownLevel(w))}
        </p>
        <p className="text-sm text-muted">{w.description}</p>
      </div>
      <span className="flex items-center gap-2">
        {heart(libraryKey(w.id), w.workout.name)}
        <button className={button.small} disabled={w.id === starterId} onClick={() => onStarter(w)}>
          {w.id === starterId ? "Loaded" : "Load"}
        </button>
      </span>
    </li>
  );

  const savedRow = (s: CustomWorkout, removable: boolean) => (
    <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
      <div className="min-w-0">
        <p className={`truncate text-[15px] ${s.id === customId ? "font-medium" : ""}`}>{s.workout.name}</p>
        <p className="num text-sm text-muted">{workoutLine(workoutDuration(s.workout), plannedStress(s.workout))}</p>
      </div>
      <span className="flex items-center gap-2">
        {heart(customKey(s.id), s.workout.name)}
        <button className={button.small} disabled={s.id === customId} onClick={() => onCustom(s)}>
          {s.id === customId ? "Loaded" : "Load"}
        </button>
        {removable && (
          <button className={button.ghost} onClick={() => onDelete(s)} aria-label={`Delete ${s.workout.name}`}>
            Delete
          </button>
        )}
      </span>
    </li>
  );

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
          <ul className="max-h-[28rem] divide-y divide-rule overflow-y-auto border-y border-rule">{shown.map(libraryRow)}</ul>
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

/**
 * Head unit with Zwift, in the Lactic app on a computer: Lactic stays in the menu bar and gets the
 * head unit ready whenever Zwift, Rouvy or MyWhoosh opens.
 */
function HeadUnitAuto() {
  const [on, setOn] = useHeadUnitAuto();
  if (!canWatchApps()) return null;
  return (
    <label className="mt-4 flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
      <span>
        <span className="block text-[15px]">Start with Zwift, Rouvy or MyWhoosh</span>
        <span className="block text-sm text-muted">Lactic stays in the menu bar. When one opens, pedal and the head unit starts.</span>
      </span>
    </label>
  );
}
