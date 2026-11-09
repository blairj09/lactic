"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import WorkoutProfile from "@/components/workout-profile";
import { Result, button, input } from "@/components/ui";
import { blankWorkout } from "@/lib/engine/workout-edit";
import type { Workout } from "@/lib/engine/workout";
import type { ActionResult } from "../actions";
import WorkoutEditor from "../ride/workout-editor";
import { moveDay, resetPlanDay, saveDayLibrary, saveDayWorkout } from "./actions";
import { LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout } from "@/lib/engine/workout-library";
import { formatTime } from "../ride/player";
import Select from "@/components/select";
import OutdoorToggle from "@/components/outdoor-toggle";

const DRAG_TYPE = "application/x-mycoach-day";
/** The day being dragged, in case the web view hides custom drag types until drop. */
let dragging: string | null = null;

export interface EditableDayInfo {
  date: string;
  /** "Sat, Nov 1". */
  label: string;
  workout: Workout | null;
  /** The day differs from the engine's plan (your change or the coach's). */
  changed: boolean;
  /** The coach's reason for this day's workout, if it picked one. */
  why: string | null;
  /** Set when the day can be ridden outside: whether it already is. */
  outside?: boolean | null;
}

/**
 * A future plan day you can open (click) to edit its workout, or drag onto another day to swap the two.
 * Links and buttons inside the cell keep working as before.
 */
export default function EditableDay({
  day,
  ftp,
  moveTargets,
  className,
  children,
}: {
  day: EditableDayInfo;
  ftp: number;
  /** Every day a session can move to, for the dialog's Move to list. */
  moveTargets: { date: string; label: string }[];
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const drop = (from: string) => {
    if (from === day.date) return;
    start(async () => {
      const r = await moveDay(from, day.date);
      setResult(r.ok ? null : r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${day.label}: open to edit${day.workout ? " or drag to another day" : ""}`}
        draggable={Boolean(day.workout)}
        onClick={(e) => {
          if ((e.target as Element).closest("a, button")) return;
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        onDragStart={(e) => {
          dragging = day.date;
          e.dataTransfer.setData(DRAG_TYPE, day.date);
          e.dataTransfer.setData("text/plain", day.date);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          dragging = null;
        }}
        onDragOver={(e) => {
          if (!dragging && !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const from = e.dataTransfer.getData(DRAG_TYPE) || dragging;
          dragging = null;
          if (from) drop(from);
        }}
        title={day.workout ? "Click to edit, drag to move" : "Click to add a workout"}
        className={`${className ?? ""} cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${
          over ? "outline-2 -outline-offset-2 outline-accent" : ""
        } ${pending ? "opacity-50" : ""}`}
      >
        {children}
        {(pending || result) && (
          <div className="px-3 pb-2 text-xs">{pending ? <span className="text-muted">Moving…</span> : result && <Result ok={result.ok}>{result.message}</Result>}</div>
        )}
      </div>
      {open && <DayDialog day={day} ftp={ftp} moveTargets={moveTargets.filter((t) => t.date !== day.date)} onClose={() => setOpen(false)} />}
    </>
  );
}

function DayDialog({ day, ftp, moveTargets, onClose }: { day: EditableDayInfo; ftp: number; moveTargets: { date: string; label: string }[]; onClose: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Workout | null>(day.workout);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  /** A starter library workout picked for the day; saved as itself while the draft is unedited. */
  const [picked, setPicked] = useState("");
  // The editor starts folded so the popup leads with the workout and the coach's reason.
  const [editorOpen, setEditorOpen] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const edited = draft !== day.workout;

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const run = (action: () => Promise<ActionResult>, closeAfter = true) =>
    start(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) {
        router.refresh();
        if (closeAfter) onClose();
      }
    });

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 py-4 sm:px-6 sm:py-10"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${day.label} workout`}
        className="relative w-full max-w-4xl space-y-5 rounded-xl border border-line bg-ground p-4 shadow-2xl outline-none sm:p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-xl text-muted hover:bg-raised hover:text-ink"
        >
          ×
        </button>
        <div className="space-y-1 pr-10">
          <h2 className="text-lg font-medium">{day.label}</h2>
          <p className="text-sm text-muted">
            {draft ? draft.name : "Rest day"}
            {day.changed && " · changed from the plan"}
          </p>
        </div>

        {day.why && (
          <div className="space-y-1 rounded-lg border border-line bg-surface p-4 text-sm">
            <div className="text-xs font-medium text-muted">Why this workout</div>
            <p className="whitespace-pre-line">{day.why}</p>
          </div>
        )}

        {draft ? (
          <>
            <WorkoutProfile workout={draft} height={56} details ftp={ftp} />
            <WorkoutEditor
              workout={draft}
              ftp={ftp}
              intensity={100}
              position={0}
              edited={false}
              open={editorOpen}
              onToggle={() => setEditorOpen((o) => !o)}
              canSave
              savedId={savedId}
              onChange={setDraft}
              onSaved={setSavedId}
            />
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-5 text-sm">
            <span className="text-muted">Nothing planned.</span>
            <button type="button" className={button.secondary} onClick={() => {
                setDraft(blankWorkout("Endurance"));
                setEditorOpen(true);
              }}>
              Add a workout
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-rule pt-4">
          <button
            type="button"
            className={button.primary}
            disabled={pending || !edited}
            onClick={() => run(() => (picked && draft === libraryWorkout(picked)?.workout ? saveDayLibrary(day.date, picked) : saveDayWorkout(day.date, draft)))}
          >
            {pending ? "Saving…" : draft ? "Save to this day" : "Make it a rest day"}
          </button>
          {draft && day.workout && (
            <button type="button" className={button.secondary} disabled={pending} onClick={() => run(() => saveDayWorkout(day.date, null))}>
              Make it a rest day
            </button>
          )}
          <Select
            aria-label="Use a library workout"
            value={picked}
            onChange={(id) => {
              const entry = libraryWorkout(id);
              setPicked(id);
              if (entry) setDraft(entry.workout);
            }}
            className={`${input} h-8 px-2`}
          >
            <option value="">Use a library workout…</option>
            {WORKOUT_LIBRARY.map((w) => (
              <option key={w.id} value={w.id}>
                {`${LIBRARY_CATEGORY_LABELS[w.category]}: ${w.workout.name} (${formatTime(w.duration)})`}
              </option>
            ))}
          </Select>
          {day.changed && (
            <button type="button" className={button.ghost} disabled={pending} onClick={() => run(() => resetPlanDay(day.date))}>
              Restore the plan&apos;s workout
            </button>
          )}
          {day.workout && day.outside != null && !edited && <OutdoorToggle day={day.date} outside={day.outside} />}
          {day.workout && moveTargets.length > 0 && (
            <span className="flex items-center gap-2 text-sm">
              <Select aria-label="Move to" value={moveTo} onChange={(v) => setMoveTo(v)} className={`${input} h-8 px-2`}>
                <option value="">Move to…</option>
                {moveTargets.map((t) => (
                  <option key={t.date} value={t.date}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <button type="button" className={button.small} disabled={pending || !moveTo} onClick={() => run(() => moveDay(day.date, moveTo))}>
                Move
              </button>
            </span>
          )}
        </div>
        {result && <Result ok={result.ok}>{result.message}</Result>}
        <p className="text-xs text-muted">
          Changes stay through plan rebuilds and sync to intervals.icu. You can also drag a day onto another to swap them.
        </p>
      </div>
    </div>
  );
}
