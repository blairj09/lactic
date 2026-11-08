"use client";

import { button } from "@/components/ui";
import type { FeedbackDraft } from "@/lib/coach/tools";
import { isDemo } from "~/demo/flag";
import { openFeedback } from "~/feedback/dialog";

/** Feedback about Lactic the coach wrote up: the summary, and a button that opens the form with it filled in. */
export function FeedbackCard({ meta }: { meta: Record<string, unknown> }) {
  const draft = feedbackOf(meta);
  // The website demo has no feedback form.
  if (!draft || isDemo) return null;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-4 text-sm">
      <p className="font-medium">{draft.kind === "idea" ? "Suggest this to the Lactic team?" : "Tell the Lactic team about this?"}</p>
      <p className="text-muted">{draft.summary}</p>
      <button className={button.small} onClick={() => openFeedback({ kind: draft.kind, message: draft.summary })}>
        Send feedback
      </button>
    </div>
  );
}

/** The feedback a saved reply offered, if any. */
export function feedbackOf(meta: Record<string, unknown>): FeedbackDraft | null {
  const f = meta.feedback as Partial<FeedbackDraft> | undefined;
  return f && (f.kind === "problem" || f.kind === "idea") && typeof f.summary === "string" && f.summary ? { kind: f.kind, summary: f.summary } : null;
}
