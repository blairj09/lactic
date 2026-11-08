"use client";

import { MAX_LEVEL, MIN_LEVEL, STARTING_LEVELS, ZONES, ZONE_LABELS, buildSession, rampTest, type Levels, type Session, type Zone } from "@/lib/engine/library";
import { templateById, templatesFor } from "@/lib/engine/templates";
import { plannedStress, workoutDuration } from "@/lib/engine/workout";
import { customKey, libraryKey, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout, type LibraryCategory, type LibraryWorkout } from "@/lib/engine/workout-library";
import type { CustomWorkout } from "@/lib/custom-workouts";
import FavoriteButton from "@/components/favorite-button";
import { useState } from "react";
import { Panel, Segmented, button } from "@/components/ui";
import { formatTime } from "./player";

/** What the player is set up to ride: the plan's session, a generated workout, a starter library workout, one of My workouts, or free ERG. */
export type RideSource = "planned" | "library" | "starter" | "custom" | "erg";

/** My workouts' shelves: the starter library, your saved workouts, and favorites from both. */
type Shelf = "library" | "saved" | "favorites";

/** The three ways to pick a ride: the day's session, a workout (library or your own), or a free ride. */
type Mode = "planned" | "pick" | "erg";

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

const chip =
  "h-8 rounded-md border border-control px-3 text-sm text-muted transition-colors hover:text-ink disabled:opacity-50 aria-checked:border-ink aria-checked:font-medium aria-checked:text-ink";

const sessionLine = (s: Session, showLevel: boolean) => `${formatTime(s.duration)} · TSS ${Math.round(s.stress)}${showLevel ? ` · level ${s.level}` : ""}`;

/**
 * What to ride: the day's planned session, a workout (from the engine's library or My workouts,
 * where a .zwo file can be imported), or a free ride at one ERG target. Picking loads it into the
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
  /** A .zwo file is being saved into My workouts. */
  importing: boolean;
  onSource: (source: RideSource) => void;
  onLibrary: (choice: LibraryChoice) => void;
  onCustom: (saved: CustomWorkout) => void;
  onStarter: (entry: LibraryWorkout) => void;
  onFavorite: (key: string, on: boolean) => void;
  /** Starts a new workout from a blank warmup and cooldown. */
  onNew: () => void;
  onDelete: (saved: CustomWorkout) => void;
  /** Imports a .zwo file into My workouts and loads it. */
  onFile: (file: File) => void;
}) {
  const mode: Mode = source === "planned" ? "planned" : source === "erg" ? "erg" : "pick";
  const modes: { value: Mode; label: string }[] = [
    ...(planned ? [{ value: "planned" as const, label: plannedLabel }] : []),
    { value: "pick", label: "Pick a workout" },
    { value: "erg", label: "Free ride" },
  ];
  const session = librarySession(library, levels);
  const leveled = library.kind !== "rampTest" && library.kind !== "recovery";
  // Structures for the zone; endurance also rides steady, with no structure.
  const structures =
    library.kind === "rampTest" || library.kind === "recovery"
      ? []
      : [...(library.kind === "endurance" ? [{ id: undefined, name: "Steady" }] : []), ...templatesFor(library.kind).map((t) => ({ id: t.id as string | undefined, name: t.name }))];
  const picked = templateById(session.template);
  const shelfOpen = source === "custom" || source === "starter";

  return (
    <Panel>
      <div className="space-y-5">
        <Segmented
          label="What to ride"
          options={modes}
          value={mode}
          onChange={(m) => onSource(m === "planned" ? "planned" : m === "erg" ? "erg" : "library")}
        />

        {source === "planned" && planned && (
          <p className="text-sm text-muted">
            <span className="text-[15px] font-medium text-ink">{planned.workout.name}</span>
            <span className="num"> · {sessionLine(planned, planned.zone !== "recovery")}</span>
          </p>
        )}

        {mode === "pick" && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Workout type">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={source === "library" && library.kind === k.value}
                onClick={() => onLibrary({ ...library, kind: k.value, shift: 0, template: undefined })}
                className={chip}
              >
                {k.label}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={shelfOpen} onClick={() => onSource("custom")} className={chip}>
              My workouts
            </button>
          </div>
        )}

        {source === "library" && (
          <div className="space-y-4">
            {structures.length > 1 && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Workout structure">
                {structures.map((t) => (
                  <button
                    key={t.id ?? "steady"}
                    type="button"
                    role="radio"
                    aria-checked={(library.template ?? (library.kind === "endurance" ? undefined : `${library.kind}-intervals`)) === t.id}
                    onClick={() => onLibrary({ ...library, template: t.id })}
                    className={chip}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {library.kind !== "rampTest" && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Segmented
                  label="Length"
                  options={MINUTES.map((m) => ({ value: m, label: `${m} min` }))}
                  value={library.minutes}
                  onChange={(minutes) => onLibrary({ ...library, minutes })}
                />
                {leveled && (
                  <span className="flex items-center gap-2">
                    <button className={button.small} onClick={() => onLibrary({ ...library, shift: library.shift - 1 })}>
                      Easier
                    </button>
                    <button className={button.small} onClick={() => onLibrary({ ...library, shift: library.shift + 1 })}>
                      Harder
                    </button>
                  </span>
                )}
              </div>
            )}
            <div className="space-y-1">
              <p className="text-sm text-muted">
                <span className="text-[15px] font-medium text-ink">{session.workout.name}</span>
                <span className="num"> · {sessionLine(session, leveled)}</span>
              </p>
              {picked && <p className="text-sm text-muted">{picked.description}</p>}
            </div>
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
          />
        )}

        {source === "erg" && (
          <p className="text-sm text-muted">One ERG target you change as you go. The ride runs until you pause and save it.</p>
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
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Library type">
            {(["all", ...LIBRARY_CATEGORIES] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} className={chip}>
                {c === "all" ? "All" : LIBRARY_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
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
              {canSave ? "Nothing saved yet. Build one, import a .zwo file, or save any workout from the editor." : "Build one in the editor, or import a .zwo file."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button className={button.secondary} onClick={onNew}>
              New workout
            </button>
            <label className={`${button.secondary} cursor-pointer focus-within:outline-2 focus-within:outline-ink ${importing ? "pointer-events-none opacity-50" : ""}`}>
              {importing ? "Importing..." : "Import .zwo"}
              <input
                type="file"
                accept=".zwo"
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
