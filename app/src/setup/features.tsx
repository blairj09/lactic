// What to track besides rides and the plan: sleep and recovery, and weight. Used by first-run
// setup and Settings; each one turned off hides its part of the app.

import type { Feature, Features } from "@/lib/features";
import { useFeatures } from "@/lib/use-features";
import { saveFeatures } from "~/settings/features";

const OPTIONS: { key: Feature; title: string; line: string; needs: string }[] = [
  {
    key: "recovery",
    title: "Sleep and recovery",
    line: "A daily recovery score from your sleep, HRV and resting heart rate.",
    needs: "Needs a watch or ring: Apple Watch, Garmin, Oura, WHOOP and others.",
  },
  {
    key: "weight",
    title: "Weight",
    line: "A morning weigh-in, your weight trend and body fat.",
    needs: "From a smart scale, or synced from another app.",
  },
];

export function FeatureChoice({ values, onChange }: { values: Features; onChange: (next: Features) => void }) {
  return (
    <div className="space-y-3">
      {OPTIONS.map((o) => (
        <label
          key={o.key}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-4 transition-colors hover:border-control has-[:checked]:border-ink"
        >
          <input type="checkbox" className="mt-1 size-4 accent-[var(--ink)]" checked={values[o.key]} onChange={(e) => onChange({ ...values, [o.key]: e.target.checked })} />
          <span className="space-y-0.5">
            <span className="block font-medium">{o.title}</span>
            <span className="block text-sm text-muted">{o.line}</span>
            <span className="block text-sm text-faint">{o.needs}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Settings: the same choice, saved as soon as it changes. */
export function FeatureSetting() {
  const values = useFeatures();
  return (
    <div className="space-y-3 sm:col-span-2">
      <FeatureChoice values={values} onChange={(next) => void saveFeatures(next)} />
      <p className="text-sm text-muted">Rides and your plan are always on. Turning one off hides it; anything already saved stays.</p>
    </div>
  );
}
