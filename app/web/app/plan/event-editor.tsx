"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Result, button } from "@/components/ui";
import type { Goal } from "@/lib/engine/plan";
import type { ActionResult } from "../actions";
import { deleteGoal } from "./actions";
import { GoalForm } from "./forms";
import CourseField from "./course-field";
import { useExperiments } from "@/lib/use-experiments";

/** An event's day on the Plan calendar: click it to change the event (name, date, start, kind, priority, length) or remove it. */
export default function EditableEvent({ goal, label, today, className, children }: { goal: Goal; label: string; today: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${goal.name}, open to edit the event`}
        title="Click to edit the event"
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
        className={`${className ?? ""} cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink`}
      >
        {children}
      </div>
      {open && <EventDialog goal={goal} label={label} today={today} onClose={() => setOpen(false)} />}
    </>
  );
}

function EventDialog({ goal, label, today, onClose }: { goal: Goal; label: string; today: string; onClose: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const courses = useExperiments().course_prep;

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

  const remove = () =>
    start(async () => {
      const r = await deleteGoal(goal.id);
      setResult(r);
      if (r.ok) {
        router.refresh();
        onClose();
      }
    });

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-10 sm:pb-10"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${goal.name} event`}
        className="relative w-full max-w-xl space-y-5 rounded-xl border border-line bg-ground p-4 shadow-2xl outline-none sm:p-6"
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
          <h2 className="text-lg font-medium">{goal.name}</h2>
          <p className="text-sm text-muted">
            {label} · {goal.priority} event
          </p>
        </div>

        <GoalForm today={today} goal={goal} onDone={onClose} />
        {courses && <CourseField goal={goal} />}

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4 text-sm">
          {confirming ? (
            <>
              <span>Remove {goal.name} from the plan?</span>
              <button type="button" className={button.secondary} disabled={pending} onClick={remove}>
                {pending ? "Removing…" : "Remove"}
              </button>
              <button type="button" className={button.ghost} disabled={pending} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="text-muted underline-offset-4 hover:text-negative hover:underline" onClick={() => setConfirming(true)}>
              Remove event
            </button>
          )}
        </div>
        {result && !result.ok && <Result ok={false}>{result.message}</Result>}
        <p className="text-xs text-muted">A new date or priority rebuilds the plan around the event.</p>
      </div>
    </div>
  );
}
