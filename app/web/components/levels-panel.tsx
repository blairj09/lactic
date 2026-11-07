import { Panel } from "@/components/ui";
import { INTERVAL_ZONES, MAX_LEVEL, ZONE_LABELS } from "@/lib/engine/library";
import { addDays } from "@/lib/engine/pmc";
import { signedFixed } from "@/lib/format";
import { levelsOn, type TrainingState } from "@/lib/training";

/** How far back the change beside each level reaches. */
const CHANGE_DAYS = 28;

/** Where you are in each zone now, and how that moved over the last four weeks. The plan's day cells show the level each session uses. */
export default function LevelsPanel({ state }: { state: TrainingState }) {
  const zones = ["endurance", ...INTERVAL_ZONES] as const;
  const before = levelsOn(state, addDays(state.today, -CHANGE_DAYS));
  return (
    <Panel title="Progression levels" meta={`1 to ${MAX_LEVEL}, with the change over ${CHANGE_DAYS / 7} weeks; workouts are picked to match`}>
      <dl className="num grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {zones.map((z) => {
          const change = Math.round((state.levels[z] - before[z]) * 10) / 10;
          return (
            <div key={z} className="space-y-1">
              <dt className="text-sm text-muted">{ZONE_LABELS[z]}</dt>
              <dd className="space-y-2">
                <span className="text-xl font-medium">{state.levels[z].toFixed(1)}</span>
                {change !== 0 && <span className="ml-2 text-sm text-muted">{signedFixed(change)}</span>}
                <span className="block h-1 rounded-full bg-raised">
                  <span className="block h-1 rounded-full bg-accent" style={{ width: `${(state.levels[z] / MAX_LEVEL) * 100}%` }} />
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </Panel>
  );
}
