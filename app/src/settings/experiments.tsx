// Saving and loading which experimental features are on (web/lib/experiments.ts holds it for the screens),
// and the Settings section that turns them on.

import { EXPERIMENTS, EXPERIMENTS_SETTING, NO_EXPERIMENTS, parseExperiments, setCurrentExperiments, type Experiments } from "@/lib/experiments";
import { useExperiments } from "@/lib/use-experiments";
import { SwitchRow } from "@/components/switch";
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
    <div className="space-y-4 sm:col-span-2">
      {EXPERIMENTS.map((x) => (
        <SwitchRow key={x.id} label={x.title} hint={x.line} on={values[x.id]} onChange={(on) => void saveExperiments({ ...values, [x.id]: on })} />
      ))}
      <p className="text-sm text-faint">These may change or go away. Turning one off keeps what&apos;s saved.</p>
    </div>
  );
}
