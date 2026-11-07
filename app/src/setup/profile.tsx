// About you: the numbers the engine needs to set zones and stress. Everything but weight is
// optional, and FTP has an "I don't know" that starts from a sensible guess the app refines.

import { useEffect, useState } from "react";
import { saveSettings } from "@/app/actions";
import { Field, Result, Segmented, input } from "@/components/ui";
import { createClient } from "~/db/supabase-client";

export interface ProfileValues {
  ftp: string;
  ftpUnknown: boolean;
  weight: string;
  units: "metric" | "imperial";
  maxHr: string;
  birthDate: string;
  sex: "" | "male" | "female";
  height: string;
  timezone: string;
}

const LB = 2.20462;
const IN = 2.54;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** A starting FTP from weight, for riders who've never tested: about 2.5 W/kg. */
export const guessFtp = (kg: number) => Math.round((kg * 2.5) / 5) * 5;

export function useProfile() {
  const [values, setValues] = useState<ProfileValues>({ ftp: "", ftpUnknown: false, weight: "", units: "metric", maxHr: "", birthDate: "", sex: "", height: "", timezone: zone() });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void createClient()
      .from("athlete_settings")
      .select("*")
      .maybeSingle()
      .then(({ data }) => {
        const imperial = (localStorage.getItem("lactic.units") ?? "") === "imperial";
        if (data) {
          setValues((v) => ({
            ...v,
            units: imperial ? "imperial" : "metric",
            ftp: data.ftp_watts ? String(data.ftp_watts) : "",
            weight: data.weight_kg ? String(imperial ? Math.round(data.weight_kg * LB * 10) / 10 : data.weight_kg) : "",
            maxHr: data.max_hr ? String(data.max_hr) : "",
            birthDate: data.birth_date ?? "",
            sex: data.sex ?? "",
            height: data.height_cm ? String(imperial ? Math.round(data.height_cm / IN) : data.height_cm) : "",
            timezone: data.timezone && data.timezone !== "UTC" ? data.timezone : zone(),
          }));
        } else if (imperial) setValues((v) => ({ ...v, units: "imperial" }));
        setLoaded(true);
      });
  }, []);
  return { values, setValues, loaded };
}

/** Saves through the app's own settings action (which also records FTP history). */
export async function saveProfile(v: ProfileValues) {
  const kg = v.weight ? (v.units === "imperial" ? Number(v.weight) / LB : Number(v.weight)) : null;
  const cm = v.height ? (v.units === "imperial" ? Number(v.height) * IN : Number(v.height)) : null;
  if (!kg || !(kg > 30 && kg < 200)) return { ok: false, message: "Add your weight so power can be shown per kilo." };
  const ftp = v.ftpUnknown ? guessFtp(kg) : Number(v.ftp);
  if (!(ftp > 50 && ftp < 700)) return { ok: false, message: "FTP should be between 50 and 700 W, or tick “I don't know”." };
  try {
    localStorage.setItem("lactic.units", v.units);
  } catch {}
  const form = new FormData();
  form.set("ftp_watts", String(Math.round(ftp)));
  form.set("weight_kg", String(Math.round(kg * 10) / 10));
  if (cm) form.set("height_cm", String(Math.round(cm)));
  if (v.maxHr) form.set("max_hr", v.maxHr);
  if (v.birthDate) form.set("birth_date", v.birthDate);
  form.set("sex", v.sex);
  form.set("timezone", v.timezone);
  return saveSettings(null, form);
}

export function ProfileForm({ values: v, onChange, error }: { values: ProfileValues; onChange: (v: ProfileValues) => void; error?: string | null }) {
  const set = <K extends keyof ProfileValues>(k: K, value: ProfileValues[K]) => onChange({ ...v, [k]: value });
  const kg = v.weight ? (v.units === "imperial" ? Number(v.weight) / LB : Number(v.weight)) : null;
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Segmented
          label="Units"
          value={v.units}
          onChange={(u) => {
            const w = Number(v.weight);
            const h = Number(v.height);
            onChange({
              ...v,
              units: u,
              weight: v.weight && u !== v.units ? String(Math.round((u === "imperial" ? w * LB : w / LB) * 10) / 10) : v.weight,
              height: v.height && u !== v.units ? String(Math.round(u === "imperial" ? h / IN : h * IN)) : v.height,
            });
          }}
          options={[
            { value: "metric", label: "kg · cm" },
            { value: "imperial", label: "lb · in" },
          ]}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="FTP" hint={v.ftpUnknown ? `Lactic starts at ${kg ? `${guessFtp(kg)} W` : "about 2.5 W/kg"} and refines it as you ride.` : "The power you can hold for about an hour."}>
          <div className="flex items-center gap-3">
            <div className="relative w-36">
              <input className={`${input} w-full pr-8`} inputMode="numeric" value={v.ftp} disabled={v.ftpUnknown} onChange={(e) => set("ftp", e.target.value.replace(/\D/g, ""))} placeholder="250" />
              <span className="pointer-events-none absolute top-2 right-3 text-sm text-muted">W</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={v.ftpUnknown} onChange={(e) => set("ftpUnknown", e.target.checked)} /> I don&apos;t know
            </label>
          </div>
        </Field>
        <Field label="Weight">
          <div className="relative w-36">
            <input className={`${input} w-full pr-9`} inputMode="decimal" value={v.weight} onChange={(e) => set("weight", e.target.value.replace(/[^\d.]/g, ""))} placeholder={v.units === "imperial" ? "160" : "72"} />
            <span className="pointer-events-none absolute top-2 right-3 text-sm text-muted">{v.units === "imperial" ? "lb" : "kg"}</span>
          </div>
        </Field>
        <Field label="Max heart rate" hint="Optional. The highest you've seen.">
          <div className="relative w-36">
            <input className={`${input} w-full pr-12`} inputMode="numeric" value={v.maxHr} onChange={(e) => set("maxHr", e.target.value.replace(/\D/g, ""))} placeholder="185" />
            <span className="pointer-events-none absolute top-2 right-3 text-sm text-muted">bpm</span>
          </div>
        </Field>
        <Field label="Height" hint="Optional, for smart scale body fat.">
          <div className="relative w-36">
            <input className={`${input} w-full pr-9`} inputMode="decimal" value={v.height} onChange={(e) => set("height", e.target.value.replace(/[^\d.]/g, ""))} placeholder={v.units === "imperial" ? "70" : "178"} />
            <span className="pointer-events-none absolute top-2 right-3 text-sm text-muted">{v.units === "imperial" ? "in" : "cm"}</span>
          </div>
        </Field>
        <Field label="Birth date" hint="Optional, for heart rate zones and fitness age.">
          <input type="date" className={`${input} w-44`} value={v.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
        </Field>
        <div className="space-y-2">
          <span className="block text-sm font-medium">Sex</span>
          <Segmented
            label="Sex"
            value={v.sex}
            onChange={(s) => set("sex", s)}
            options={[
              { value: "female", label: "Female" },
              { value: "male", label: "Male" },
              { value: "", label: "Skip" },
            ]}
          />
          <span className="block text-sm text-muted">Optional, for VO2 max and body fat.</span>
        </div>
      </div>
      <p className="text-sm text-muted">Time zone: {v.timezone}</p>
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}
