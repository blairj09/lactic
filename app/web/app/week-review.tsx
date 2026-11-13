import { Panel, Stat } from "@/components/ui";
import type { DayMark } from "@/lib/engine/compliance";
import { DIFFICULTIES, DIFFICULTY_LABELS } from "@/lib/engine/feedback";
import { ZONE_LABELS } from "@/lib/engine/library";
import type { WeekReview } from "@/lib/engine/review";
import { signed } from "@/lib/format";
import { Prose } from "./coach/prose";

// Besides done, which is the figure.
const MARKS: [DayMark, string][] = [
  ["partial", "partly done"],
  ["moved", "moved"],
  ["missed", "missed"],
  ["unplanned", "unplanned"],
];

/**
 * The coach's look back at last week, at the top of Progress → Trends once it's written: the engine's numbers
 * (stress against the plan, how days went, how sessions felt, levels that moved) with the coach's words
 * under them, and what this week is.
 */
export default function WeekReviewCard({ review, message, thisWeek }: { review: WeekReview; message: string; thisWeek: string | null }) {
  const days = MARKS.filter(([m]) => review.marks[m] > 0).map(([m, word]) => `${review.marks[m]} ${word}`);
  const felt = DIFFICULTIES.filter((d) => review.felt[d] > 0).map((d) => `${review.felt[d]} ${DIFFICULTY_LABELS[d].toLowerCase()}`);
  return (
    <Panel
      title="Last week"
      meta={range(review.start, review.end)}
    >
      <div className="space-y-4">
        {/* Two by two on a phone, so the card stays short. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          <Stat label="Stress" value={review.done} unit={review.planned ? `of ${review.planned} TSS` : "TSS"} sub={review.planned ? `${Math.round((review.done / review.planned) * 100)}% of the plan` : "Nothing planned"} />
          <Stat label="Days" value={review.marks.done} unit="done" sub={days.join(" · ") || (review.marks.done ? "Everything planned" : "Nothing planned")} />
          <Stat label="Rides" value={review.rides} sub={`${(review.seconds / 3600).toFixed(1)} h`} />
          <Stat label="Fitness" value={review.fitness} sub={`${signed(review.fitnessChange)} over the week · form ${signed(review.form)}`} />
        </div>
        {(felt.length > 0 || review.levels.length > 0) && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {felt.length > 0 && (
              <div>
                <dt className="text-muted">How it felt</dt>
                <dd className="num">
                  {felt.join(", ")}
                  {review.rpe !== null && ` · RPE ${review.rpe}`}
                </dd>
              </div>
            )}
            {review.levels.length > 0 && (
              <div>
                <dt className="text-muted">Levels</dt>
                <dd className="num">{review.levels.map((l) => `${ZONE_LABELS[l.zone]} ${l.from.toFixed(1)} → ${l.to.toFixed(1)}`).join(", ")}</dd>
              </div>
            )}
          </dl>
        )}
        <Prose text={message} />
        {thisWeek && <p className="text-sm text-muted">{thisWeek}</p>}
      </div>
    </Panel>
  );
}

function range(start: string, end: string) {
  const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(start)} to ${f(end)}`;
}
