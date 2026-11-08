"use client";

import { MAX_LEVEL, MIN_LEVEL, STARTING_LEVELS, ZONES, ZONE_LABELS, buildSession, rampTest, type Levels, type Session, type Zone } from "@/lib/engine/library";
import { templateById, templatesFor } from "@/lib/engine/templates";
import { plannedStress, workoutDuration } from "@/lib/engine/workout";
import type { CustomWorkout } from "@/lib/custom-workouts";
import { Panel, Segmented, button } from "@/components/ui";
import { formatTime } from "./player";

/** What the player is set up to ride. */
export type RideSource = "planned" | "library" | "custom" | "erg";

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
  canSave,
  importing,
  onSource,
  onLibrary,
  onCustom,
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
  canSave: boolean;
  /** A .zwo file is being saved into My workouts. */
  importing: boolean;
  onSource: (source: RideSource) => void;
  onLibrary: (choice: LibraryChoice) => void;
  onCustom: (saved: CustomWorkout) => void;
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
            <button type="button" role="radio" aria-checked={source === "custom"} onClick={() => onSource("custom")} className={chip}>
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

        {source === "custom" && (
          <div className="space-y-4">
            {saved.length > 0 ? (
              <ul className="divide-y divide-rule border-y border-rule">
                {saved.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5">
                    <div className="min-w-0">
                      <p className={`truncate text-[15px] ${s.id === customId ? "font-medium" : ""}`}>{s.workout.name}</p>
                      <p className="num text-sm text-muted">
                        {formatTime(workoutDuration(s.workout))} · TSS {Math.round(plannedStress(s.workout))}
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <button className={button.small} disabled={s.id === customId} onClick={() => onCustom(s)}>
                        {s.id === customId ? "Loaded" : "Load"}
                      </button>
                      <button className={button.ghost} onClick={() => onDelete(s)} aria-label={`Delete ${s.workout.name}`}>
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">
                {canSave
                  ? "Nothing saved yet. Build one, import a .zwo file, or save any workout from the editor."
                  : "Build one in the editor, or import a .zwo file."}
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

        {source === "erg" && (
          <p className="text-sm text-muted">One ERG target you change as you go. The ride runs until you pause and save it.</p>
        )}
      </div>
    </Panel>
  );
}
