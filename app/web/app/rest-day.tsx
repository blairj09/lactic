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

/** A bike parked for the night under a moon and stars. */
function RestArt() {
  return (
    <svg viewBox="0 -8 170 122" className="h-28 w-40 shrink-0 text-accent" aria-hidden="true">
      <circle cx="85" cy="62" r="58" className="fill-accent-soft" />
      <path d="M128 6 a13 13 0 1 0 14 18 a10 10 0 1 1 -14 -18 Z" fill="currentColor" />
      <g fill="currentColor">
        <circle cx="40" cy="16" r="2" />
        <circle cx="60" cy="6" r="1.5" opacity="0.6" />
        <circle cx="104" cy="14" r="1.5" opacity="0.6" />
        <circle cx="24" cy="38" r="1.5" opacity="0.5" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="38" cy="82" r="25" />
        <circle cx="132" cy="82" r="25" />
        <path d="M38 82 L80 84 L70 42 Z" />
        <path d="M70 42 L118 40 L80 84" />
        <path d="M118 40 L122 54 Q128 70 132 82" />
        <path d="M70 42 L67 32" />
        <path d="M57 31 L77 31" strokeWidth="4.5" />
        <path d="M118 40 L116 33 L126 32 Q134 32 134 40 Q134 46 128 47" />
        <circle cx="80" cy="84" r="7" />
        <path d="M80 84 L85 96 M80 96 L90 96" />
        <path d="M56 83 L50 107" strokeWidth="3" />
        <path d="M20 108 L150 108" strokeWidth="3" opacity="0.25" />
      </g>
      <circle cx="38" cy="82" r="2.5" fill="currentColor" />
      <circle cx="132" cy="82" r="2.5" fill="currentColor" />
    </svg>
  );
}
