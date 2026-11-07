"use client";

import { useEffect, useRef, useState } from "react";
import { intervals, isAllOut, plannedStress, powerZone, ramp, steady, workoutDuration, type Segment, type Workout } from "@/lib/engine/workout";
import {
  MAX_NAME,
  changeKind,
  duplicateSegment,
  editable,
  insertSegments,
  minDuration,
  moveSegment,
  parseDuration,
  removeSegment,
  repeats,
  updateSegment,
  type SegmentKind,
} from "@/lib/engine/workout-edit";
import { Panel, Segmented, button, input } from "@/components/ui";
import { saveCustomWorkout } from "./actions";
import { formatTime } from "./player";
import Select from "@/components/select";

const UNIT_PREF = "ride.editorUnit";
const UNDO_DEPTH = 50;

type Unit = "percent" | "watts";

const KIND_LABELS: Record<SegmentKind, string> = { steady: "Steady", ramp: "Ramp", freeRide: "Free ride" };

const zoneColor = (segment: Segment) =>
  segment.kind === "freeRide" ? "var(--zone-free)" : `var(--zone-${powerZone(segment.kind === "steady" ? segment.target : (segment.from + segment.to) / 2)})`;

/**
 * A text box that edits on blur or Enter, so half-typed values ("1" on the way to "105") don't
 * reach the trainer. Escape puts the value back.
 */
function DraftInput({
  value,
  onCommit,
  label,
  className,
  disabled,
}: {
  value: string;
  onCommit: (text: string) => void;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
    // A rejected value snaps back to the stored one.
    setDraft(value);
  };
  return (
    <input
      aria-label={label}
      value={draft}
      disabled={disabled}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
      className={`${input} num h-8 px-2 ${className ?? ""}`}
    />
  );
}

/**
 * The loaded workout's intervals, editable: length, kind and target of each, plus adding, repeating,
 * reordering and removing them. Edits apply to this ride; Save keeps it in My workouts. Mid-ride,
 * what's ridden is locked and the interval under way can only change its target and length.
 */
export default function WorkoutEditor({
  workout,
  ftp,
  intensity,
  position,
  edited,
  canSave,
  savedId,
  open,
  onToggle,
  onChange,
  onSaved,
}: {
  /** The workout at 100% intensity. */
  workout: Workout;
  ftp: number;
  intensity: number;
  /** Seconds into the workout; 0 before the ride starts. */
  position: number;
  edited: boolean;
  canSave: boolean;
  /** Set when the workout was loaded from (or saved to) My workouts. */
  savedId: string | null;
  /** Collapsed, only the title row with the workout's length and TSS shows. */
  open: boolean;
  onToggle: () => void;
  onChange: (workout: Workout) => void;
  onSaved: (id: string, workout: Workout) => void;
}) {
  const [unit, setUnit] = useState<Unit>("percent");
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "muted" | "negative"; text: string } | null>(null);
  const [rep, setRep] = useState({ count: 4, work: 240, workTarget: 1.05, rest: 120, restTarget: 0.5 });
  const history = useRef<Workout[]>([]);
  const [, setUndoCount] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem(UNIT_PREF) === "watts") setUnit("watts");
    } catch {}
  }, []);

  const pickUnit = (next: Unit) => {
    setUnit(next);
    try {
      localStorage.setItem(UNIT_PREF, next);
    } catch {}
  };

  const change = (next: Workout) => {
    if (next === workout) return;
    history.current = [...history.current.slice(-(UNDO_DEPTH - 1)), workout];
    setUndoCount(history.current.length);
    setMessage(null);
    onChange(next);
  };

  const undo = () => {
    const previous = history.current.pop();
    setUndoCount(history.current.length);
    if (previous) onChange(previous);
  };

  const all = intervals(workout);
  const scale = intensity / 100;
  const watts = (fraction: number) => Math.round(fraction * ftp * scale);
  const shown = (fraction: number) => String(unit === "percent" ? Math.round(fraction * 100) : Math.round(fraction * ftp));
  const readTarget = (text: string): number | null => {
    const n = Number(text.trim().replace(/%|w$/i, ""));
    if (!Number.isFinite(n) || n < 0 || text.trim() === "") return null;
    return unit === "percent" ? n / 100 : ftp > 0 ? n / ftp : null;
  };

  // Additions go after the selected interval, else before the last one (usually the cooldown),
  // and never before the interval under way.
  const firstFree = all.findIndex((_, i) => editable(workout, position, i) === "free");
  const lowest = firstFree === -1 ? workout.segments.length - 1 : firstFree - 1;
  const insertAfter = Math.max(lowest, selected ?? workout.segments.length - 2);
  const insertLabel = insertAfter < 0 ? "at the start" : insertAfter >= workout.segments.length - 1 ? "at the end" : `after #${insertAfter + 1}`;

  const setSegment = (index: number, segment: Segment) => change(updateSegment(workout, index, segment));

  const save = async (asNew: boolean) => {
    setSaving(true);
    const result = await saveCustomWorkout({ id: asNew ? undefined : (savedId ?? undefined), workout });
    setSaving(false);
    setMessage({ tone: result.ok ? "muted" : "negative", text: result.message });
    if (result.ok) onSaved(result.id, workout);
  };

  const duration = workoutDuration(workout);
  const ridden = position > 0;

  return (
    <Panel
      // Collapsed, the title row's bottom margin stands in for the padding.
      className={open ? undefined : "pb-1"}
      title={
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-2 hover:text-muted">
          <span aria-hidden className={`inline-block text-xs transition-transform ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
          Workout editor
        </button>
      }
      meta={
        <span className="num">
          {formatTime(duration)} · TSS {Math.round(plannedStress(workout) * scale * scale)}
          {edited && " · edited for this ride"}
        </span>
      }
    >
      {open && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="block space-y-1.5 text-sm">
              <span className="block text-muted">Name</span>
              <input
                value={workout.name}
                maxLength={MAX_NAME}
                onChange={(e) => onChange({ ...workout, name: e.target.value })}
                className={`${input} w-72 max-w-full`}
                aria-label="Workout name"
              />
            </label>
            <Segmented
              label="Targets in"
              options={[
                { value: "percent" as const, label: "% FTP" },
                { value: "watts" as const, label: "Watts" },
              ]}
              value={unit}
              onChange={pickUnit}
            />
            <button className={button.ghost} disabled={history.current.length === 0} onClick={undo}>
              Undo
            </button>
          </div>

          {intensity !== 100 && (
            <p className="text-sm text-muted">Targets here are at 100%. The watts column shows them at this ride&apos;s {intensity}% intensity.</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="w-10 pb-2 font-normal">#</th>
                  <th className="pb-2 font-normal">Type</th>
                  <th className="pb-2 font-normal">Length</th>
                  <th className="pb-2 font-normal">{unit === "percent" ? "Target, % FTP" : "Target, W at 100%"}</th>
                  <th className="pb-2 font-normal">Watts</th>
                  <th className="pb-2 font-normal">Starts</th>
                  <th className="pb-2 font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="border-t border-rule">
                {all.map(({ index, start, segment }) => {
                  const state = editable(workout, position, index);
                  const done = state === "done";
                  const fixed = state !== "free";
                  const isSelected = selected === index;
                  const range =
                    segment.kind === "steady"
                      ? `${watts(segment.target)}`
                      : segment.kind === "ramp"
                        ? `${watts(segment.from)} → ${watts(segment.to)}`
                        : "–";
                  return (
                    <tr key={index} className={`border-b border-rule ${done ? "opacity-45" : ""} ${isSelected ? "bg-raised" : ""}`} aria-selected={isSelected}>
                      <td className="py-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(isSelected ? null : index)}
                          className="num flex items-center gap-2 text-muted hover:text-ink"
                          aria-label={`Select interval ${index + 1}`}
                          title="Select: additions go after it"
                        >
                          <span className="size-2.5 rounded-full" style={{ background: zoneColor(segment) }} />
                          {index + 1}
                        </button>
                      </td>
                      <td className="py-1.5 pr-2">
                        <Select
                          aria-label={`Interval ${index + 1} type`}
                          value={segment.kind}
                          disabled={done}
                          onChange={(v) => setSegment(index, changeKind(segment, v as SegmentKind))}
                          className={`${input} h-8 px-2`}
                        >
                          {(Object.keys(KIND_LABELS) as SegmentKind[]).map((k) => (
                            <option key={k} value={k}>
                              {KIND_LABELS[k]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <DraftInput
                          label={`Interval ${index + 1} length`}
                          value={formatTime(segment.duration)}
                          disabled={done}
                          className="w-20"
                          onCommit={(text) => {
                            const seconds = parseDuration(text);
                            if (seconds !== null) setSegment(index, { ...segment, duration: Math.max(seconds, minDuration(workout, position, index)) });
                          }}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        {segment.kind === "steady" && (
                          <span className="flex items-center gap-1.5">
                            <DraftInput
                              label={`Interval ${index + 1} target`}
                              value={shown(segment.target)}
                              disabled={done}
                              className="w-16"
                              onCommit={(text) => {
                                const target = readTarget(text);
                                if (target !== null) setSegment(index, { ...segment, target });
                              }}
                            />
                            <button
                              type="button"
                              aria-pressed={isAllOut(segment)}
                              disabled={done}
                              onClick={() => setSegment(index, { ...segment, allOut: !isAllOut(segment) })}
                              title="All out: ERG lets go and the trainer rides like a road, so you can sprint past the target"
                              className={`rounded px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors disabled:opacity-50 ${isAllOut(segment) ? "bg-primary text-on-primary" : "bg-raised text-muted hover:bg-active"}`}
                            >
                              All out
                            </button>
                          </span>
                        )}
                        {segment.kind === "ramp" && (
                          <span className="flex items-center gap-1.5">
                            <DraftInput
                              label={`Interval ${index + 1} start target`}
                              value={shown(segment.from)}
                              disabled={done}
                              className="w-16"
                              onCommit={(text) => {
                                const from = readTarget(text);
                                if (from !== null) setSegment(index, { ...segment, from });
                              }}
                            />
                            <span className="text-muted">→</span>
                            <DraftInput
                              label={`Interval ${index + 1} end target`}
                              value={shown(segment.to)}
                              disabled={done}
                              className="w-16"
                              onCommit={(text) => {
                                const to = readTarget(text);
                                if (to !== null) setSegment(index, { ...segment, to });
                              }}
                            />
                          </span>
                        )}
                        {segment.kind === "freeRide" && <span className="text-muted">No ERG target</span>}
                      </td>
                      <td className="num py-1.5 pr-2 whitespace-nowrap">{range}</td>
                      <td className="num py-1.5 pr-2 text-muted">{formatTime(start)}</td>
                      <td className="py-1.5">
                        <span className="flex items-center justify-end gap-1">
                          <IconButton label={`Move interval ${index + 1} up`} disabled={fixed || editable(workout, position, index - 1) !== "free" || index === 0} onClick={() => change(moveSegment(workout, index, -1))}>
                            ↑
                          </IconButton>
                          <IconButton label={`Move interval ${index + 1} down`} disabled={fixed || index === all.length - 1} onClick={() => change(moveSegment(workout, index, 1))}>
                            ↓
                          </IconButton>
                          <IconButton label={`Duplicate interval ${index + 1}`} disabled={done} onClick={() => change(duplicateSegment(workout, index))}>
                            ⧉
                          </IconButton>
                          <IconButton
                            label={`Delete interval ${index + 1}`}
                            disabled={fixed || all.length <= 1}
                            onClick={() => {
                              change(removeSegment(workout, index));
                              setSelected(null);
                            }}
                          >
                            ✕
                          </IconButton>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">Add {insertLabel}:</span>
              <button className={button.small} onClick={() => change(insertSegments(workout, insertAfter, [steady(300, 0.65)]))}>
                Steady
              </button>
              <button className={button.small} onClick={() => change(insertSegments(workout, insertAfter, [ramp(300, 0.5, 0.75)]))}>
                Ramp
              </button>
              <button className={button.small} onClick={() => change(insertSegments(workout, insertAfter, [{ kind: "freeRide", duration: 300 }]))}>
                Free ride
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Repeats:</span>
              <DraftInput label="Repeat count" value={String(rep.count)} className="w-12" onCommit={(t) => Number(t) >= 1 && setRep({ ...rep, count: Math.min(50, Math.round(Number(t))) })} />
              <span>×</span>
              <DraftInput label="Work length" value={formatTime(rep.work)} className="w-16" onCommit={(t) => parseDuration(t) && setRep({ ...rep, work: parseDuration(t)! })} />
              <span>at</span>
              <DraftInput label="Work target" value={shown(rep.workTarget)} className="w-16" onCommit={(t) => readTarget(t) !== null && setRep({ ...rep, workTarget: readTarget(t)! })} />
              <span className="text-muted">{unit === "percent" ? "%" : "W"}, then</span>
              <DraftInput label="Recovery length" value={formatTime(rep.rest)} className="w-16" onCommit={(t) => parseDuration(t) && setRep({ ...rep, rest: parseDuration(t)! })} />
              <span>at</span>
              <DraftInput label="Recovery target" value={shown(rep.restTarget)} className="w-16" onCommit={(t) => readTarget(t) !== null && setRep({ ...rep, restTarget: readTarget(t)! })} />
              <span className="text-muted">{unit === "percent" ? "%" : "W"}</span>
              <button
                className={button.small}
                onClick={() =>
                  change(insertSegments(workout, insertAfter, repeats(rep.count, { duration: rep.work, target: rep.workTarget }, { duration: rep.rest, target: rep.restTarget })))
                }
              >
                Add set
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-4">
            {canSave ? (
              <>
                <button className={button.secondary} disabled={saving} onClick={() => save(false)}>
                  {saving ? "Saving..." : savedId ? "Save changes" : "Save to My workouts"}
                </button>
                {savedId && (
                  <button className={button.ghost} disabled={saving} onClick={() => save(true)}>
                    Save as new
                  </button>
                )}
              </>
            ) : (
              <span className="text-sm text-muted">Sign in to save workouts.</span>
            )}
            {message && <p className={`text-sm ${message.tone === "negative" ? "text-negative" : "text-muted"}`}>{message.text}</p>}
            {ridden && <p className="text-sm text-muted">Mid-ride, intervals already ridden are locked.</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
