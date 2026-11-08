"use client";

import { Result, button, input } from "@/components/ui";
import { hrZones, powerZones, type ZoneRange } from "@/lib/engine/zones";
import { useActionState, useState } from "react";
import { saveSettings } from "../actions";
import { heightIn, heightToCm, heightUnit, weightIn, weightToKg, weightUnit, type UnitSystem } from "@/lib/units";
import { useUnits } from "@/lib/use-units";
import { useFeatures } from "@/lib/use-features";

type NumberField = "ftp_watts" | "threshold_hr" | "max_hr" | "weight_kg" | "height_cm" | "sleep_need_hours";
type Values = Record<NumberField, number | null> & { timezone: string; birth_date: string | null; sex: "male" | "female" | null };

const FIELDS: { name: NumberField; label: string; unit: string; hint?: string; step?: string }[] = [
  { name: "ftp_watts", label: "FTP", unit: "W", hint: "Applies from today. Earlier rides keep theirs." },
  { name: "threshold_hr", label: "Threshold", unit: "bpm" },
  { name: "max_hr", label: "Max", unit: "bpm" },
  { name: "weight_kg", label: "Weight", unit: "kg", step: "0.1", hint: "Weigh-ins keep this up to date." },
  { name: "height_cm", label: "Height", unit: "cm", step: "0.5" },
  { name: "sleep_need_hours", label: "Sleep need", unit: "hours", step: "0.25" },
];

/** Fields typed in the rider's units: shown converted, saved in metric. */
const CONVERT: Partial<Record<NumberField, { show: (v: number, u: UnitSystem) => number; save: (v: number, u: UnitSystem) => number; unit: (u: UnitSystem) => string }>> = {
  weight_kg: { show: weightIn, save: weightToKg, unit: weightUnit },
  height_cm: { show: heightIn, save: heightToCm, unit: heightUnit },
};

const GROUPS: { title: string; description: string; fields: NumberField[] }[] = [
  { title: "Body", description: "Height, birth date and sex are for body composition from a smart scale.", fields: ["weight_kg", "height_cm"] },
];

/** One save for every setting; sections are a label column beside their fields. */
export default function SettingsForm({ values, ftpSource = null }: { values: Values; ftpSource?: string | null }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  // Live copies of the training inputs so the zones follow what's typed, before saving.
  const [ftp, setFtp] = useState(values.ftp_watts);
  const [thresholdHr, setThresholdHr] = useState(values.threshold_hr);
  const [maxHr, setMaxHr] = useState(values.max_hr);
  // Weight and height are typed in the rider's units and saved in kg and cm.
  const units = useUnits();
  const tracking = useFeatures();
  const [body, setBody] = useState<Partial<Record<NumberField, number | null>>>({ weight_kg: values.weight_kg, height_cm: values.height_cm });
  const numberField = (name: NumberField, onValue?: (value: number | null) => void, width = "w-28") => {
    const f = FIELDS.find((x) => x.name === name)!;
    const convert = CONVERT[name];
    if (convert) {
      const metric = body[name] ?? null;
      return (
        <label key={f.name} className="block space-y-2">
          <span className="block text-sm font-medium">{f.label}</span>
          <span className="flex items-center gap-2">
            <input
              key={units}
              type="number"
              step={f.step ?? "1"}
              defaultValue={metric === null ? "" : Math.round(convert.show(metric, units) * 10) / 10}
              onChange={(e) => setBody((b) => ({ ...b, [name]: e.target.value === "" ? null : convert.save(Number(e.target.value), units) }))}
              className={`${input} num ${width}`}
            />
            <input type="hidden" name={f.name} value={metric === null ? "" : Math.round(metric * 100) / 100} />
            <span className="text-sm text-muted">{convert.unit(units)}</span>
          </span>
          {f.hint && <span className="block text-sm text-muted">{f.hint}</span>}
        </label>
      );
    }
    return (
      <label key={f.name} className="block space-y-2">
        <span className="block text-sm font-medium">{f.label}</span>
        <span className="flex items-center gap-2">
          <input
            name={f.name}
            type="number"
            step={f.step ?? "1"}
            defaultValue={values[f.name] ?? ""}
            onChange={onValue && ((e) => onValue(e.target.value === "" ? null : Number(e.target.value)))}
            className={`${input} num ${width}`}
          />
          <span className="text-sm text-muted">{f.unit}</span>
        </span>
        {f.hint && <span className="block text-sm text-muted">{f.hint}</span>}
      </label>
    );
  };
  return (
    <form id="profile" action={action} className="scroll-mt-16 space-y-4">
      <Section title="Training" description="Zones, workouts and training stress come from these.">
        <div className="space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint">Power</h3>
          {numberField("ftp_watts", setFtp)}
          {ftpSource && ftp === values.ftp_watts && <p className="-mt-2 text-xs text-muted">{ftpSource}</p>}
          <Zones title="Power zones" unit="W" zones={ftp && ftp > 0 ? powerZones(ftp) : null} empty="Add an FTP to see zones." />
        </div>
        <div className="space-y-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-faint">Heart rate</h3>
          <div className="flex gap-5">
            {numberField("threshold_hr", setThresholdHr, "w-20")}
            {numberField("max_hr", setMaxHr, "w-20")}
          </div>
          <p className="text-sm text-muted">Threshold sets zones, and stress on rides without power.</p>
          <Zones
            title="Heart rate zones"
            unit="bpm"
            zones={thresholdHr && thresholdHr > 0 ? hrZones(thresholdHr, maxHr && maxHr > 0 ? maxHr : null) : null}
            empty="Add a threshold to see zones."
          />
        </div>
      </Section>
      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title} description={g.description}>
          {g.fields.map((name) => numberField(name))}
          {g.title === "Body" && (
            <>
              <label className="block space-y-2">
                <span className="block text-sm font-medium">Birth date</span>
                <input name="birth_date" type="date" defaultValue={values.birth_date ?? ""} className={input} />
              </label>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Sex</legend>
                <span className="flex h-9 items-center gap-5 text-sm">
                  {(["male", "female"] as const).map((sex) => (
                    <label key={sex} className="flex items-center gap-2">
                      <input type="radio" name="sex" value={sex} defaultChecked={values.sex === sex} className="size-4 accent-[var(--ink)]" />
                      {sex === "male" ? "Male" : "Female"}
                    </label>
                  ))}
                </span>
              </fieldset>
            </>
          )}
        </Section>
      ))}
      <Section
        title={tracking.recovery ? "Sleep and time" : "Time"}
        description={tracking.recovery ? "Sleep need is recovery's target. The time zone decides which day a ride counts for." : "The time zone decides which day a ride counts for."}
      >
        {tracking.recovery ? numberField("sleep_need_hours") : <input type="hidden" name="sleep_need_hours" value={values.sleep_need_hours ?? ""} />}
        <label className="block space-y-2">
          <span className="block text-sm font-medium">Time zone</span>
          <input name="timezone" defaultValue={values.timezone} className={`${input} w-64 max-w-full`} />
          <span className="block text-sm text-muted">For example America/Los_Angeles.</span>
        </label>
      </Section>
      <div className="flex flex-wrap items-center justify-end gap-4">
        {state && <Result ok={state.ok}>{state.message}</Result>}
        <button disabled={pending} className={button.primary}>
          {pending ? "Saving..." : "Save settings"}
        </button>
      </div>
    </form>
  );
}

/** Read-only zone table; the zone dots use the same ramp as the Ride page. */
function Zones({ title, unit, zones, empty }: { title: string; unit: string; zones: ZoneRange[] | null; empty: string }) {
  if (!zones) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">{title}</span>
      <ul className="divide-y divide-rule rounded-md border border-line text-sm">
        {zones.map((z) => (
          <li key={z.zone} className="flex items-center gap-2 px-3 py-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: `var(--zone-${z.zone})` }} />
            <span className="num w-6 text-muted">Z{z.zone}</span>
            <span className="flex-1 truncate">{z.name}</span>
            <span className="num text-muted">
              {z.zone === 1 ? `< ${z.high! + 1}` : z.high === null ? `${z.low}+` : `${z.low}–${z.high}`} {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Section({ id, title, description, children }: { id?: string; title: string; description: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-1 md:pt-5">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 rounded-lg border border-line bg-surface p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}
