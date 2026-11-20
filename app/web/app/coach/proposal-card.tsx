"use client";

import { useState, useTransition } from "react";
import type { Proposal } from "@/lib/coach/changes";
import { button } from "@/components/ui";
import WorkoutProfile from "@/components/workout-profile";

/** The proposed workout's chart; hover (or tap) a part for its details. */
export function ProposalWorkout({ proposal }: { proposal: Proposal }) {
  if (!proposal.workout) return null;
  return <WorkoutProfile workout={proposal.workout.workout} height={56} details ftp={proposal.workout.ftp} fit />;
}

/** Days shown before the rest fold away. */
const SHOWN_DAYS = 5;

const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** An event's details before the reason. */
export function ProposalFields({ proposal }: { proposal: Proposal }) {
  const fields = proposal.preview?.fields;
  if (!fields?.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
      {fields.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-muted">{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** For event and plan changes: the days that change, or the plan's weeks, and the engine's numbers. */
export function ProposalPlan({ proposal }: { proposal: Proposal }) {
  const [all, setAll] = useState(false);
  const preview = proposal.preview;
  if (!preview) return null;
  const days = preview.days ?? [];
  const shown = all ? days : days.slice(0, SHOWN_DAYS);
  const row = "grid gap-2.5 border-b border-line py-2 leading-snug";
  return (
    <>
      {preview.weeks && preview.weeks.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Weeks</p>
          <div className="border-t border-line">
            {preview.weeks.map((w) => (
              <div key={w.start} className={`${row} grid-cols-[4.5rem_6.5rem_1fr]`}>
                <span className="text-muted">{weekLabel(w.start)}</span>
                <span>{w.phase}</span>
                <span>
                  {w.hours.toFixed(1)} h · {w.stress} TSS
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {days.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Plan changes</p>
          <div className="border-t border-line">
            {shown.map((d) => (
              <div key={d.date} className={`${row} grid-cols-[5.5rem_1fr]`}>
                <span className="text-muted">{dayLabel(d.date)}</span>
                <span>
                  <s className="text-faint decoration-1">{d.before}</s>
                  <span className="mx-1.5 text-faint">→</span>
                  <span className={d.event ? "font-semibold text-accent" : "font-medium"}>{d.after}</span>
                </span>
              </div>
            ))}
          </div>
          {days.length > SHOWN_DAYS && (
            <button type="button" className="pt-2 text-[13px] text-accent" onClick={() => setAll(!all)}>
              {all ? "Fewer days" : `${days.length - SHOWN_DAYS} more ${days.length - SHOWN_DAYS === 1 ? "day" : "days"}`}
            </button>
          )}
        </div>
      )}
      {preview.stats && preview.stats.length > 0 && (
        <p className="flex flex-wrap gap-x-4 text-muted">
          {preview.stats.map((s) => (
            <span key={s.label}>
              {s.label} <b className="font-semibold text-ink">{s.value}</b>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/** A plan change the coach proposed: the engine's summary, the workout's chart, the coach's reason, and Apply or Dismiss. */
export function ProposalCard({ proposal, onApply, onDismiss }: { proposal: Proposal; onApply: () => Promise<void>; onDismiss: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="font-medium">{proposal.summary}</p>
      <ProposalWorkout proposal={proposal} />
      <ProposalFields proposal={proposal} />
      {proposal.reason && <p className="text-muted">{proposal.reason}</p>}
      <ProposalPlan proposal={proposal} />
      {proposal.status === "pending" ? (
        <div className="flex gap-2">
          <button className={button.smallPrimary} disabled={pending} onClick={() => start(onApply)}>
            {pending ? "Applying..." : "Apply"}
          </button>
          <button className={button.small} disabled={pending} onClick={() => start(onDismiss)}>
            Dismiss
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted">{proposal.status === "applied" ? "Applied" : "Dismissed"}</p>
      )}
    </div>
  );
}
