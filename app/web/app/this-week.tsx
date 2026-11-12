import Link from "next/link";
import { Panel } from "@/components/ui";
import { DAY_MARK_LABELS } from "@/lib/engine/compliance";
import { addDays } from "@/lib/engine/pmc";
import { PHASE_LABELS, weekStart } from "@/lib/engine/plan";
import { planWeek, weekGlance, type GlanceDay, type Tracking } from "@/lib/engine/week-glance";
import { complianceDays, type TrainingState } from "@/lib/training";

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
export default function ThisWeek({ state, className }: { state: TrainingState; className?: string }) {
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
            <DayCell key={d.date} day={d} today={today} />
          ))}
        </ol>
      </div>
    </Panel>
  );
}

function DayCell({ day, today }: { day: GlanceDay; today: string }) {
  const isToday = day.date === today;
  const past = day.date < today;
  const letter = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const rest = day.planned === 0 && day.done === 0;
  // Filled when ridden, outlined when still to come, dashed when missed or moved.
  const ridden = day.done > 0 && (day.mark === null || day.mark === "done" || day.mark === "unplanned");
  const tone = ridden
    ? "bg-accent text-white border-accent"
    : day.mark === "partial"
      ? "bg-accent-soft text-ink border-accent"
      : day.mark === "missed"
        ? "border-dashed border-warning text-warning"
        : day.mark === "moved"
          ? "border-dashed border-line text-muted"
          : rest
            ? "border-transparent bg-raised text-faint"
            : "border-line text-muted";
  const symbol = ridden ? "✓" : day.mark === "partial" ? "½" : day.mark === "missed" ? "✕" : day.mark === "moved" ? "→" : rest ? "Rest" : "";
  const label = day.mark ? DAY_MARK_LABELS[day.mark] : ridden ? "Ridden" : rest ? "Rest" : past ? "" : `${day.planned} TSS planned`;
  return (
    <li className="min-w-0 text-center" title={`${letter}: ${label}`}>
      <div className={`text-xs ${isToday ? "font-medium text-ink" : "text-muted"}`}>{isToday ? "Today" : letter}</div>
      <div
        className={`num mt-1 flex h-11 items-center justify-center rounded-md border text-sm ${tone} ${isToday ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
      >
        {symbol}
      </div>
      <div className="num mt-1 truncate text-[11px] text-muted">{day.done ? `${day.done} TSS` : day.planned ? `${day.planned} TSS` : " "}</div>
    </li>
  );
}
