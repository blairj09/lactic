import Link from "next/link";
import { formatDuration } from "@/lib/format";
import type { TrainingState } from "@/lib/training";

// Said on rest days, one per date so it stays put through the day.
const LINES = [
  "Fitness is built on the bike and banked on the couch. Today you bank it.",
  "Legs up. Today's training happens while you rest.",
  "No intervals, no targets. The hardest part is not riding.",
  "Your muscles are rebuilding. Let them work.",
  "Rest is part of the plan, not a break from it.",
  "Feet up, snack in hand. Coach's orders.",
  "Today's workout: sleep well, eat well, do nothing heroic.",
];

/** The rest-day card body: a sleeping bike, a line to enjoy it, and what's next. */
export default function RestDay({ state }: { state: TrainingState }) {
  const { today } = state;
  const line = LINES[Math.floor(Date.parse(`${today}T12:00:00Z`) / 86_400_000) % LINES.length];
  const next = state.plan.weeks
    .flatMap((w) => w.days)
    .find((d) => d.date > today && (d.session || d.goal));
  const day = next && new Date(`${next.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return (
    <div className="flex flex-col items-center gap-5 py-2 text-center sm:flex-row sm:items-center sm:text-left">
      <RestArt />
      <div className="space-y-3">
        <p className="text-[17px] leading-snug">{line}</p>
        {next && (
          <p className="text-sm text-muted">
            Next up: {day},{" "}
            {next.goal ? next.goal.name : `${next.session!.workout.name} · ${formatDuration(next.session!.duration)} · ${Math.round(next.stress)} TSS`}.
          </p>
        )}
        <p className="text-sm text-muted">
          Itching to ride?{" "}
          <Link href="/ride" className="text-ink underline underline-offset-4">
            An easy spin
          </Link>{" "}
          is fine. Keep it chatty.
        </p>
      </div>
    </div>
  );
}

/** A bike asleep on its kickstand, dreaming in z's. */
function RestArt() {
  return (
    <svg viewBox="0 -16 170 126" className="h-28 w-40 shrink-0 text-accent" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="38" cy="78" r="24" />
        <circle cx="118" cy="78" r="24" />
        <path d="M38 78 L64 46 L104 46 L118 78 M64 46 L80 78 L104 46 M80 78 L38 78" />
        <path d="M60 36 L72 36 M64 46 L60 36" />
        <path d="M104 46 L100 32 L112 30" />
      </g>
      <circle cx="80" cy="78" r="5" fill="currentColor" />
      <g fill="currentColor" className="text-muted" fontFamily="inherit" fontWeight="600">
        <text x="118" y="22" fontSize="16" className="fill-current opacity-60">z</text>
        <text x="130" y="14" fontSize="20" className="fill-current opacity-80">z</text>
        <text x="145" y="6" fontSize="24" className="fill-current">Z</text>
      </g>
    </svg>
  );
}
