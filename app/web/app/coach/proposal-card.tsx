"use client";

import { useTransition } from "react";
import type { Proposal } from "@/lib/coach/changes";
import { button } from "@/components/ui";

/** A plan change the coach proposed: the engine's summary, the coach's reason, and Apply or Dismiss. */
export function ProposalCard({ proposal, onApply, onDismiss }: { proposal: Proposal; onApply: () => Promise<void>; onDismiss: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="font-medium">{proposal.summary}</p>
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
