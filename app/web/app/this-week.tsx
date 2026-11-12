import Link from "next/link";
import { Panel } from "@/components/ui";
import { DAY_MARK_LABELS } from "@/lib/engine/compliance";
import { addDays } from "@/lib/engine/pmc";
import { PHASE_LABELS, weekStart } from "@/lib/engine/plan";
import { planWeek, weekGlance, type GlanceDay, type Tracking } from "@/lib/engine/week-glance";
import WorkoutProfile from "@/components/workout-profile";
import type { Workout } from "@/lib/engine/workout";
import { complianceDays, plannedOn, type TrainingState } from "@/lib/training";

const TRACKING: Record<Tracking, string> = {
  ahead: "Ahead of plan",
  onTrack: "On track",
  behind: "Behind plan",
  early: "Week just started",
};
const TRACKING_TONE: Record<Tracking, string> = {
  ahead: "bg-pill-positive text-positive",
  onTrack: "bg-pill-positive text-positive",
  behind: "bg-pill-warning text-warning",
  early: "bg-raised text-muted",
};

/**
 * How the week and the plan are coming, at a glance: each day's plan and how it went, stress so far against the
 * plan to date, and the week of the saved plan. Numbers come from the engine (week-glance.ts).
 */
export default function ThisWeek({ state, rideShapes = {}, className }: { state: TrainingState; rideShapes?: Record<string, number[]>; className?: string }) {
  const { today } = state;
  const monday = weekStart(today);
  const glance = weekGlance(complianceDays(state, addDays(monday, -1), addDays(monday, 7)), monday, today);
  const week = state.plan.weeks.find((w) => w.start === monday);
  const plan = state.activePlan;
  const n = plan ? planWeek(plan.start, plan.end, monday) : null;
  const where = [
    n && plan ? `Week ${n.n} of ${n.of}, ${plan.name}` : null,
    week ? (week.recoveryWeek ? "recovery week" : PHASE_LABELS[week.phase].toLowerCase()) : null,
  ].filter(Boolean);

  return (
    <Panel
      title="This week"
      meta={
        <Link href="/plan" className="hover:text-ink">
          {where.length ? where.join(" · ") : "Plan"}
        </Link>
      }
      className={className}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="num text-2xl font-medium tracking-tight">
            {glance.done} <span className="text-sm font-normal text-muted">{glance.planned ? `of ${glance.planned} TSS` : "TSS"}</span>
          </p>
          {glance.planned > 0 && <span className={`rounded px-2 py-0.5 text-xs font-medium ${TRACKING_TONE[glance.tracking]}`}>{TRACKING[glance.tracking]}</span>}
          <span className="text-sm text-muted">
            {glance.sessions > 0
              ? `${glance.sessionsDone} of ${glance.sessions} sessions${glance.plannedToDate ? ` · ${glance.plannedToDate} TSS planned so far` : ""}`
              : "Nothing planned this week"}
          </span>
        </div>
        <ol className="grid grid-cols-7 gap-1.5" aria-label="Days this week">
          {glance.days.map((d) => (
            <DayCell key={d.date} day={d} today={today} shape={rideShapes[d.date] ?? null} ftp={state.athlete.ftp} workout={plannedOn(state, d.date)?.session?.workout ?? null} event={state.plan.weeks.flatMap((w) => w.days).find((p) => p.date === d.date)?.goal?.name ?? null} />
          ))}
        </ol>
      </div>
    </Panel>
  );
}

/** One day: its workout's shape and stress inside the tile, ticked once ridden. */
function DayCell({ day, today, workout, event, shape, ftp }: { day: GlanceDay; today: string; workout: Workout | null; event: string | null; shape: number[] | null; ftp: number | null }) {
  const isToday = day.date === today;
  const letter = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const rest = day.planned === 0 && day.done === 0 && !event;
  const ridden = day.done > 0 && (day.mark === null || day.mark === "done" || day.mark === "unplanned");
  const tone = ridden
    ? "border-accent bg-accent-soft"
    : day.mark === "partial"
      ? "border-accent border-dashed bg-accent-soft"
      : day.mark === "missed"
        ? "border-dashed border-warning"
        : day.mark === "moved"
          ? "border-dashed border-line"
          : rest
            ? "border-transparent bg-raised"
            : "border-line bg-ground";
  const badge = ridden ? "✓" : day.mark === "partial" ? "½" : day.mark === "missed" ? "✕" : day.mark === "moved" ? "→" : null;
  const label = day.mark ? DAY_MARK_LABELS[day.mark] : ridden ? "Ridden" : rest ? "Rest" : `${day.planned} TSS planned`;
  // Show what was ridden once there is something, else what's planned.
  const stress = day.done || day.planned;
  return (
    <li className="min-w-0 text-center" title={`${letter}: ${label}`}>
      <div className={`text-xs ${isToday ? "font-medium text-ink" : "text-muted"}`}>{isToday ? "Today" : letter}</div>
      <div
        className={`relative mt-1 flex h-16 flex-col overflow-hidden rounded-md border sm:h-24 ${tone} ${isToday ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
      >
        {rest ? (
          <span className="m-auto text-xs text-faint">Rest</span>
        ) : (
          <>
            <div className="flex items-start justify-between px-1.5 pt-1">
              <span className={`num text-xs font-medium sm:text-sm ${day.mark === "missed" ? "text-warning" : "text-ink"}`}>{stress || ""}</span>
              {badge && (
                <span
                  className={`hidden size-4 items-center justify-center rounded-full text-[10px] sm:flex ${ridden ? "bg-accent text-white" : day.mark === "missed" ? "text-warning" : "text-muted"}`}
                  aria-label={label}
                >
                  {badge}
                </span>
              )}
            </div>
            {ridden && shape?.length ? (
              <div className="mt-auto px-1 pb-1">
                <RideShape watts={shape} ftp={ftp} />
              </div>
            ) : event ? (
              <span className="mt-auto truncate px-1 pb-1.5 text-[11px] text-ink">{event}</span>
            ) : workout ? (
              <div className={`mt-auto px-1 pb-1 ${day.mark === "missed" || day.mark === "moved" ? "opacity-40" : ""}`}>
                <WorkoutProfile workout={workout} height={44} fit />
              </div>
            ) : (
              <span className="mt-auto pb-1.5 text-[11px] text-muted">{ridden ? "Ride" : ""}</span>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** What was ridden, as a filled power trace on the same scale as a workout's blocks (1.3 × FTP at the top). */
function RideShape({ watts, ftp }: { watts: number[]; ftp: number | null }) {
  const top = (ftp ?? Math.max(...watts)) * 1.3 || 1;
  const h = 44;
  const w = watts.length;
  const y = (v: number) => h - Math.min(1, v / top) * h;
  const path = `M0 ${h} ` + watts.map((v, i) => `L${i} ${y(v).toFixed(1)} L${i + 1} ${y(v).toFixed(1)}`).join(" ") + ` L${w} ${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block h-11 w-full text-accent" aria-hidden="true">
      <path d={path} fill="currentColor" fillOpacity={0.55} />
    </svg>
  );
}
