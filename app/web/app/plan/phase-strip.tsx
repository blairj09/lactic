import { PHASE_LABELS, type Phase } from "@/lib/engine/plan";

interface StripWeek {
  start: string;
  phase: Phase;
  recoveryWeek: boolean;
  breakNote?: "break" | "reentry";
}

/** The data hue gets stronger toward the peak; recovery and break weeks drop back to grey. */
const PHASE_FILL: Record<Phase, string> = {
  base: "bg-accent/30",
  build: "bg-accent/55",
  specialty: "bg-accent/80",
  taper: "bg-accent",
  test: "bg-accent",
};

/** One bar per week across the whole plan, coloured by phase, with this week marked. */
export default function PhaseStrip({ weeks, today }: { weeks: StripWeek[]; today: string }) {
  if (!weeks.length) return null;
  const phases = runs(weeks).map((r) => r.phase);
  return (
    <div className="space-y-1.5">
      <div className="flex h-6 gap-px" role="img" aria-label={`Phases: ${phases.map((p) => PHASE_LABELS[p]).join(", ")}`}>
        {weeks.map((w) => {
          const current = w.start <= today && today < addWeek(w.start);
          const fill = w.breakNote === "break" ? "bg-line" : w.recoveryWeek ? "bg-raised" : PHASE_FILL[w.phase];
          const label = `${w.start}: ${PHASE_LABELS[w.phase]}${w.breakNote === "break" ? ", break" : w.breakNote === "reentry" ? ", first week back" : w.recoveryWeek ? ", recovery" : ""}`;
          return (
            <span key={w.start} title={label} className={`relative flex-1 first:rounded-l last:rounded-r ${fill}`}>
              {current && <span aria-hidden className="absolute inset-x-0 -bottom-1.5 h-0.5 bg-ink" />}
            </span>
          );
        })}
      </div>
      <div className="flex gap-px text-xs text-muted">
        {runs(weeks).map((r) => (
          <span key={r.start} style={{ flexGrow: r.count, flexBasis: 0 }} className="min-w-0 truncate">
            {PHASE_LABELS[r.phase]}
          </span>
        ))}
      </div>
    </div>
  );
}

const addWeek = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);

/** Consecutive weeks in the same phase. */
function runs(weeks: StripWeek[]) {
  const out: { start: string; phase: Phase; count: number }[] = [];
  for (const w of weeks) {
    const last = out.at(-1);
    if (last?.phase === w.phase) last.count++;
    else out.push({ start: w.start, phase: w.phase, count: 1 });
  }
  return out;
}
