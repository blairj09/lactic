"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  BREAK_KIND_LABELS,
  BREAK_KINDS,
  BREAK_RIDING,
  BREAK_RIDING_LABELS,
  GOAL_KIND_LABELS,
  GOAL_KINDS,
  goalIntensity,
  goalMinutes,
  INTENSITIES,
  INTENSITY_LABELS,
  KIND_DEFAULTS,
  PHASE_LABELS,
  PLAN_GOAL_LABELS,
  PLAN_GOALS,
  type Availability,
  type BreakRiding,
  type Goal,
  type GoalKind,
  type Intensity,
  type PlanGoal,
  type SavedPlan,
} from "@/lib/engine/plan";
import { Field, Result, button, fileInput, input } from "@/components/ui";
import { ExperimentalTag } from "@/components/experimental-tag";
import { useExperiments } from "@/lib/use-experiments";
import type { ActionResult } from "../actions";
import PhaseStrip from "./phase-strip";
import CourseField from "./course-field";
import EventSearch from "./event-search";
import type { CourseLink, EventHit } from "@/lib/engine/course/events";
import { deleteBreak, deleteGoal, endPlan, pickWorkouts, replanWeek, previewPlan, saveAvailability, saveBreak, saveGoal, savePlan } from "./actions";
import { AutoTextarea } from "@/components/auto-textarea";
import Select from "@/components/select";
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Add an event, or edit one when `goal` is given. Picking a kind fills in its typical duration and intensity. */
export function GoalForm({ today, goal, onDone }: { today: string; goal?: Goal; onDone?: () => void }) {
  const [state, action, pending] = useActionState(async (previous: ActionResult | null, form: FormData) => {
    const result = await saveGoal(previous, form);
    if (result.ok) onDone?.();
    return result;
  }, null);
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "roadRace");
  const [minutes, setMinutes] = useState(goal ? goalMinutes(goal) : KIND_DEFAULTS.roadRace.minutes);
  const [intensity, setIntensity] = useState<Intensity>(goal ? goalIntensity(goal) : KIND_DEFAULTS.roadRace.intensity);
  const pickKind = (k: GoalKind) => {
    setKind(k);
    setMinutes(KIND_DEFAULTS[k].minutes);
    setIntensity(KIND_DEFAULTS[k].intensity);
  };
  const hours = Math.floor(minutes / 60);
  const courses = useExperiments().course_prep;
  const [found, setFound] = useState<{ event: EventHit; course: CourseLink | null } | null>(null);
  const filled = found ? { name: found.event.name, date: found.event.date, startTime: found.event.startTime } : goal ? { name: goal.name, date: goal.date, startTime: goal.startTime ?? null } : null;
  return (
    <div className="space-y-3">
    {!goal && courses && (
      <EventSearch
        onPick={(event, course) => {
          setFound({ event, course });
          pickKind(event.kind);
        }}
      />
    )}
    <form key={found?.event.id ?? "form"} action={action} className="space-y-3 text-sm">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <input type="hidden" name="minutes" value={minutes} />
      <div className="flex flex-wrap gap-2">
        <input name="name" placeholder="Event name" defaultValue={filled?.name} className={`${input} min-w-0 flex-1`} required />
        <input name="date" type="date" min={goal ? undefined : today} defaultValue={filled?.date} className={input} required />
        <input name="start_time" type="time" aria-label="Start time" title="Start time (optional)" defaultValue={filled?.startTime ?? ""} className={`${input} tabular-nums`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Select name="kind" className={input} value={kind} onChange={(v) => pickKind(v as GoalKind)}>
          {GOAL_KINDS.map((k) => (
            <option key={k} value={k}>
              {GOAL_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Select name="priority" className={input} defaultValue={goal?.priority ?? "A"}>
          <option value="A">A: peak for it</option>
          <option value="B">B: short taper</option>
          <option value="C">C: train through</option>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Duration</span>
        <input
          type="number"
          aria-label="Hours"
          min={0}
          max={24}
          value={hours}
          onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)) * 60 + (minutes % 60))}
          className={`${input} w-16 px-2 tabular-nums`}
        />
        h
        <input
          type="number"
          aria-label="Minutes"
          min={0}
          max={59}
          step={5}
          value={minutes % 60}
          onChange={(e) => setMinutes(hours * 60 + Math.min(59, Math.max(0, Number(e.target.value))))}
          className={`${input} w-16 px-2 tabular-nums`}
        />
        min
      </div>
      <Select name="intensity" className={`${input} w-full`} value={intensity} onChange={(v) => setIntensity(v as Intensity)}>
        {INTENSITIES.map((i) => (
          <option key={i} value={i}>
            {INTENSITY_LABELS[i]}
          </option>
        ))}
      </Select>
      {!goal && courses && (
        <div className="space-y-1">
          <span className="flex items-center gap-2">
            Course file <span className="text-muted">(optional)</span>
            <ExperimentalTag />
          </span>
          <input name="course" type="file" accept=".gpx,.tcx,.fit" className={fileInput} aria-label="Course file" />
          <input
            name="course_url"
            defaultValue={found?.course?.url ?? ""}
            placeholder="or a link: Ride with GPS, or a GPX file on the web"
            aria-label="Course link"
            className={`${input} w-full`}
          />
          <span className="block text-xs text-muted">GPX, TCX or FIT from the organizer, Ride with GPS, Strava or Komoot. You get a pre-race report, and the plan trains for its climbs.</span>
          <div className="flex flex-wrap gap-3 pt-1">
            <label className="grid gap-1">
              <span>
                Target time <span className="text-muted">(optional)</span>
              </span>
              <input name="target_time" placeholder="4:30" inputMode="numeric" aria-label="Target finish time, hours and minutes" className={`${input} w-28`} />
            </label>
            <label className="grid gap-1">
              <span>How you&apos;ll ride it</span>
              <select name="pack" defaultValue="" className={input}>
                <option value="">Usual for the event</option>
                <option value="solo">Solo</option>
                <option value="group">Small group (2 to 15)</option>
                <option value="bunch">Bunch (a peloton)</option>
              </select>
            </label>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button disabled={pending} className={button.primary}>
          {pending ? "Saving..." : goal ? "Save" : "Add event"}
        </button>
        {onDone && (
          <button type="button" className={button.secondary} onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
      {state && <Result ok={state.ok}>{state.message}</Result>}
    </form>
    </div>
  );
}

/** Upcoming events, each with edit and remove. */
export function GoalList({ goals, today }: { goals: Goal[]; today: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const courses = useExperiments().course_prep;
  if (goals.length === 0) return <p className="text-sm text-muted">No events yet.</p>;
  return (
    <ul className="text-sm">
      {goals.map((g) => (
        <li key={g.id} className="space-y-3 border-b border-rule py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span>
              <span className="mr-2 inline-block w-4 font-semibold">{g.priority}</span>
              {g.name}
              <span className="text-muted">
                {" "}
                · {GOAL_KIND_LABELS[g.kind]} · {formatMinutes(goalMinutes(g))} · {goalIntensity(g)} · {formatDate(g.date)}{g.startTime ? `, ${g.startTime}` : ""}
              </span>
              {g.course && (
                <Link href={`/plan/events/${g.id}`} className="ml-2 text-accent underline-offset-4 hover:underline">
                  Pre-race report
                </Link>
              )}
            </span>
            <span className="flex shrink-0 gap-3">
              <button className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => setEditing(editing === g.id ? null : g.id)}>
                Edit
              </button>
              <DeleteGoalButton id={g.id} />
            </span>
          </div>
          {editing === g.id && <GoalForm key={g.id} today={today} goal={g} onDone={() => setEditing(null)} />}
          {editing === g.id && courses && <CourseField goal={g} />}
        </li>
      ))}
    </ul>
  );
}

function DeleteGoalButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-sm text-muted underline-offset-4 hover:text-negative hover:underline disabled:opacity-50" disabled={pending} onClick={() => start(async () => void (await deleteGoal(id)))}>
      Remove
    </button>
  );
}

const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
const formatDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function AvailabilityForm({ availability, rampRate }: { availability: Availability; rampRate: number }) {
  const [state, action, pending] = useActionState(saveAvailability, null);
  const [minutes, setMinutes] = useState<number[]>(availability);
  const hours = minutes.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / 60;
  return (
    <form action={action} className="space-y-3 text-sm">
      <p className="text-muted">Most minutes you can ride each day. Leave 0 for days off. The long ride goes on the day with the most time.</p>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d, i) => (
          <label key={d} className="space-y-1 text-center">
            <span className="block text-xs text-muted">{d}</span>
            <input
              name={`day${i}`}
              type="number"
              min={0}
              max={480}
              step={15}
              value={minutes[i]}
              onChange={(e) => setMinutes(minutes.map((m, j) => (j === i ? Number(e.target.value) : m)))}
              className={`${input} num w-full px-1 text-center`}
            />
          </label>
        ))}
      </div>
      <p className="num">{hours.toFixed(1)} hours a week</p>
      <label className="flex flex-wrap items-center gap-2">
        How fast to build
        <Select name="ramp_rate" defaultValue={String(rampRate)} className={input}>
          <option value="3">Gently (+3 fitness a week)</option>
          <option value="5">Steady (+5)</option>
          <option value="7">Aggressive (+7)</option>
        </Select>
      </label>
      <button disabled={pending} className={button.primary}>
        {pending ? "Saving..." : "Save"}
      </button>
      {state && <Result ok={state.ok}>{state.message}</Result>}
    </form>
  );
}

/** The plan builder: dates, goal and target, with a preview of the weeks before you save. */
export function PlanForm({ today, nextMonday, events, plan }: { today: string; nextMonday: string; events: Goal[]; plan?: SavedPlan }) {
  const [saved, save, saving] = useActionState(savePlan, null);
  const [preview, runPreview, previewing] = useActionState(previewPlan, null);
  const upcoming = events.filter((e) => e.date > today);
  const [goal, setGoal] = useState<PlanGoal>(plan?.goal ?? (upcoming.some((e) => e.priority === "A") ? "event" : "ftp"));
  const firstA = upcoming.find((e) => e.priority === "A") ?? upcoming[0];
  return (
    <form action={save} className="space-y-4 text-sm">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What it's for">
          <Select name="goal" value={goal} onChange={(v) => setGoal(v as PlanGoal)} className={`${input} w-full`}>
            {PLAN_GOALS.map((g) => (
              <option key={g} value={g} disabled={g === "event" && upcoming.length === 0}>
                {PLAN_GOAL_LABELS[g]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" hint="Optional">
          <input name="name" defaultValue={plan?.name} placeholder="Winter build" className={`${input} w-full`} />
        </Field>
        <Field label="Starts">
          <input name="start" type="date" defaultValue={plan?.start ?? nextMonday} className={`${input} w-full`} required />
        </Field>
        {goal === "event" ? (
          <Field label="Peaks for" hint="The plan ends on the event day">
            <Select name="goal_id" defaultValue={plan?.goalId ?? firstA?.id} className={`${input} w-full`}>
              {upcoming.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.priority}) · {e.date}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Ends" hint={goal === "ftp" ? "The last week is easy, with a ramp test at the end" : undefined}>
            <input name="end" type="date" defaultValue={plan?.end} min={today} className={`${input} w-full`} required />
          </Field>
        )}
        {(goal === "ftp" || goal === "fitness") && (
          <Field label={goal === "ftp" ? "Target FTP (W)" : "Target fitness (CTL)"} hint="Optional; shown against the forecast">
            <input name="target" type="number" min={1} max={999} defaultValue={plan?.target ?? undefined} className={`${input} num w-full`} />
          </Field>
        )}
      </div>
      <p className="text-muted">
        Sessions fit your time to train, ramp rate and breaks, and adapt as you ride.
      </p>
      <div className="flex flex-wrap gap-2">
        <button formAction={runPreview} disabled={previewing} className={button.secondary}>
          {previewing ? "Building..." : "Preview"}
        </button>
        <button disabled={saving} className={button.primary}>
          {saving ? "Saving..." : plan ? "Save changes" : "Save plan"}
        </button>
      </div>
      {preview && !preview.ok && <Result ok={false}>{preview.message}</Result>}
      {preview?.ok && preview.weeks && (
        <div className="space-y-2 rounded-md border border-line p-3">
          <PhaseStrip weeks={preview.weeks} today={today} />
          <p className="num text-muted">
            {preview.weeks.length} weeks · average {(preview.weeks.reduce((a, w) => a + w.hours, 0) / Math.max(preview.weeks.length, 1)).toFixed(1)} h a
            week · fitness {preview.fitnessNow} now
            {preview.endFitness !== undefined && `, ${preview.endFitness} at the end`}
            {preview.eventForm !== undefined && ` (form ${preview.eventForm > 0 ? "+" : ""}${preview.eventForm} on the day)`}
          </p>
          <p className="text-muted">
            {Object.entries(countPhases(preview.weeks))
              .map(([phase, n]) => `${PHASE_LABELS[phase as keyof typeof PHASE_LABELS]} ${n} wk`)
              .join(" · ")}
          </p>
        </div>
      )}
      {saved && <Result ok={saved.ok}>{saved.message}</Result>}
    </form>
  );
}

const countPhases = (weeks: { phase: string }[]) => weeks.reduce<Record<string, number>>((acc, w) => ({ ...acc, [w.phase]: (acc[w.phase] ?? 0) + 1 }), {});

export function EndPlanButton({ id, started }: { id: string; started: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className={button.secondary}
      disabled={pending}
      onClick={() => start(async () => void (confirm(started ? "End this plan today?" : "Remove this plan?") && (await endPlan(id))))}
    >
      {started ? "End plan" : "Remove plan"}
    </button>
  );
}

/** Has the coach pick the key days' workouts again (it also does this on its own each week). */
export function PickWorkoutsButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="flex items-center gap-3">
      {result && <Result ok={result.ok}>{result.message}</Result>}
      <button className={button.secondary} disabled={pending} onClick={() => start(async () => setResult(await pickWorkouts()))}>
        {pending ? "Coach is picking…" : "Re-pick workouts"}
      </button>
    </span>
  );
}

/**
 * Offered when the rebuilt week has moved more than the drift limit from the week as it began: say how,
 * and re-plan on a click. The plan never rewrites the week on its own.
 */
export function ReplanChip({ drift }: { drift: { share: number; kept: number; rebuilt: number } }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const percent = Math.round(Math.abs(drift.share) * 100);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-raised/60 px-3 py-2 text-sm">
      <span>
        Your fitness has moved since this week was planned: a fresh plan would be {percent}% {drift.share > 0 ? "harder" : "easier"} for the days left (
        <span className="num">
          {drift.rebuilt} TSS, not {drift.kept}
        </span>
        ). The week stays as it is unless you re-plan.
      </span>
      <span className="flex items-center gap-3">
        {result && <Result ok={result.ok}>{result.message}</Result>}
        <button className={button.small} disabled={pending || result?.ok} onClick={() => start(async () => setResult(await replanWeek()))}>
          {pending ? "Re-planning…" : "Re-plan this week"}
        </button>
      </span>
    </div>
  );
}

export function BreakForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(saveBreak, null);
  const [riding, setRiding] = useState<BreakRiding>("off");
  return (
    <form action={action} className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <input name="start" type="date" min={today} aria-label="First day" className={input} required />
        <input name="end" type="date" min={today} aria-label="Last day" className={input} required />
        <Select name="kind" defaultValue="travel" className={input}>
          {BREAK_KINDS.map((k) => (
            <option key={k} value={k}>
              {BREAK_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select name="riding" value={riding} onChange={(v) => setRiding(v as BreakRiding)} className={input}>
          {BREAK_RIDING.map((r) => (
            <option key={r} value={r}>
              {BREAK_RIDING_LABELS[r]}
            </option>
          ))}
        </Select>
        {riding === "limited" && (
          <label className="flex items-center gap-2">
            <input name="minutes" type="number" min={0} max={480} step={15} defaultValue={30} className={`${input} num w-20`} />
            min a day
          </label>
        )}
      </div>
      <AutoTextarea name="note" rows={1} placeholder="Note for the coach (optional)" maxLength={500} className={`${input} h-auto w-full py-2`} />
      <button disabled={pending} className={button.primary}>
        {pending ? "Adding..." : "Add break"}
      </button>
      {state && <Result ok={state.ok}>{state.message}</Result>}
    </form>
  );
}

export function DeleteBreakButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-sm text-muted underline-offset-4 hover:text-negative hover:underline disabled:opacity-50" disabled={pending} onClick={() => start(async () => void (await deleteBreak(id)))}>
      Remove
    </button>
  );
}
