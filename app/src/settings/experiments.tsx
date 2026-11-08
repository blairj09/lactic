// Saving and loading which experimental features are on (web/lib/experiments.ts holds it for the screens),
// and the Settings section that turns them on.

import { EXPERIMENTS, EXPERIMENTS_SETTING, NO_EXPERIMENTS, parseExperiments, setCurrentExperiments, type Experiments } from "@/lib/experiments";
import { useExperiments } from "@/lib/use-experiments";
import { ExperimentalTag } from "@/components/experimental-tag";
import { revalidatePath } from "~/shims/next-cache";
import { getSetting, setSetting } from "./store";

/** Reads the saved choice into the app. Nothing saved means every experiment is off. */
export async function loadExperiments(): Promise<Experiments> {
  const saved = parseExperiments(await getSetting<unknown>(EXPERIMENTS_SETTING, NO_EXPERIMENTS).catch(() => NO_EXPERIMENTS));
  setCurrentExperiments(saved);
  return saved;
}

export async function saveExperiments(next: Experiments) {
  const value = parseExperiments(next);
  await setSetting(EXPERIMENTS_SETTING, value);
  setCurrentExperiments(value);
  revalidatePath("/");
}

export function ExperimentsSetting() {
  const values = useExperiments();
  return (
    <div className="space-y-3 sm:col-span-2">
      {EXPERIMENTS.map((x) => (
        <label
          key={x.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 transition-colors hover:border-control has-[:checked]:border-ink"
        >
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--ink)]"
            checked={values[x.id]}
            onChange={(e) => void saveExperiments({ ...values, [x.id]: e.target.checked })}
          />
          <span className="space-y-0.5">
            <span className="flex items-center gap-2 font-medium">
              {x.title}
              <ExperimentalTag />
            </span>
            <span className="block text-sm text-muted">{x.line}</span>
          </span>
        </label>
      ))}
      <p className="text-sm text-muted">Still being tried out, so they may change or go away. Turning one off hides it; anything already saved stays.</p>
    </div>
  );
}

