"use client";

import { useTransition } from "react";
import type { Proposal } from "@/lib/coach/changes";
import { button } from "@/components/ui";
import WorkoutProfile from "@/components/workout-profile";

/** The proposed workout's chart; hover (or tap) a part for its details. */
export function ProposalWorkout({ proposal }: { proposal: Proposal }) {
  if (!proposal.workout) return null;
  return <WorkoutProfile workout={proposal.workout.workout} height={56} details ftp={proposal.workout.ftp} fit />;
}

/** A plan change the coach proposed: the engine's summary, the workout's chart, the coach's reason, and Apply or Dismiss. */
export function ProposalCard({ proposal, onApply, onDismiss }: { proposal: Proposal; onApply: () => Promise<void>; onDismiss: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="font-medium">{proposal.summary}</p>
      <ProposalWorkout proposal={proposal} />
      {proposal.reason && <p className="text-muted">{proposal.reason}</p>}
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
