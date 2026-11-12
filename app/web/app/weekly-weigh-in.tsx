"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Result, button, input } from "@/components/ui";
import { canReconnectSilently, DEVICES_CHANGED, isPickerCancel, remembered } from "@/lib/ble/devices";
import { isWebBluetoothAvailable } from "@/lib/ble/sensor-hub";
import { weekStart } from "@/lib/engine/plan";
import type { WeighInDue } from "@/lib/engine/weigh-in-due";
import type { ScaleProfile } from "@/lib/scale/bodypod";
import { weighIn, type WeighInUpdate } from "@/lib/scale/scale";
import { formatWeight, weightToKg, weightUnit } from "@/lib/units";
import { useFeatures } from "@/lib/use-features";
import { useUnits } from "@/lib/use-units";
import { saveWeighIn } from "./actions";
import { STAGE_TEXT } from "./health/weigh-in";

type Weigh = { phase: "idle" } | { phase: "running"; update: WeighInUpdate | null } | { phase: "saved"; kg: number } | { phase: "failed"; message: string };

const WEIGH_SKIP = "today.weighSkip";

/**
 * The weekly weigh-in on Today: a slim card, shown only when the engine says one is due (no weigh-in
 * from the last week, from any source, and no ride yet this week). The scale comes first (Weigh in,
 * or Connect a scale where there's Bluetooth); typing a weight in is the backup; "Not this week"
 * puts it off until Monday. Once saved it says so for the rest of the visit, then goes away.
 */
export default function WeeklyWeighIn({ day, due, profile }: { day: string; due: WeighInDue; profile: ScaleProfile | null }) {
  const router = useRouter();
  const units = useUnits();
  const tracking = useFeatures();
  const [device, setDevice] = useState<{ bluetooth: boolean; scale: boolean; silent: boolean } | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [typing, setTyping] = useState(false);
  const [weigh, setWeigh] = useState<Weigh>({ phase: "idle" });
  const autoStarted = useRef(false);

  useEffect(() => {
    setDevice({ bluetooth: isWebBluetoothAvailable(), scale: Boolean(remembered("scale")), silent: canReconnectSilently() });
    setSkipped(readSkip() === weekStart(day));
  }, [day]);

  useEffect(() => {
    const refresh = () => setDevice((d) => d && { ...d, scale: Boolean(remembered("scale")) });
    window.addEventListener(DEVICES_CHANGED, refresh);
    return () => window.removeEventListener(DEVICES_CHANGED, refresh);
  }, []);

  const startWeigh = useCallback(
    async (choose = false) => {
      // The Body Pod needs the profile; weighIn says so if it's missing.
      setWeigh({ phase: "running", update: null });
      try {
        const reading = await weighIn(profile, (update) => setWeigh({ phase: "running", update }), { choose });
        setDevice((d) => d && { ...d, scale: true });
        setWeigh({ phase: "running", update: { stage: "done", liveKg: reading.weightKg } });
        const saved = await saveWeighIn(reading);
        if (!saved.ok) setWeigh({ phase: "failed", message: saved.message });
        else {
          setWeigh({ phase: "saved", kg: reading.weightKg });
          router.refresh();
        }
      } catch (e) {
        setWeigh(isPickerCancel(e) ? { phase: "idle" } : { phase: "failed", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [profile, router],
  );

  const saved = weigh.phase === "saved";
  const show = tracking.weight && device !== null && (saved || (due.due && !skipped));

  // The scale starts listening on its own when it reconnects without a click.
  useEffect(() => {
    if (!show || !device || autoStarted.current || saved || !profile) return;
    if (!device.bluetooth || !device.scale || !device.silent || weigh.phase !== "idle") return;
    autoStarted.current = true;
    void startWeigh();
  }, [show, device, saved, profile, weigh.phase, startWeigh]);

  if (!show) return null;

  const skip = () => {
    setSkipped(true);
    writeSkip(weekStart(day));
  };

  return (
    <section aria-label="Weekly weigh-in" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
      {saved ? (
        <p>
          <span className="font-medium">Weekly weigh-in:</span> <span className="num text-ink">{formatWeight(weigh.kg, units)}</span> saved. Next one in a week.
        </p>
      ) : weigh.phase === "running" ? (
        <p aria-live="polite">
          <span className="font-medium">Weekly weigh-in:</span>{" "}
          {weigh.update?.liveKg != null && <span className="num font-medium text-ink">{formatWeight(weigh.update.liveKg, units)} </span>}
          <span className="text-muted">{STAGE_TEXT[weigh.update?.stage ?? "waking"]}</span>
        </p>
      ) : typing ? (
        <TypedWeight
          onSaved={(kg) => {
            setTyping(false);
            setWeigh({ phase: "saved", kg });
            router.refresh();
          }}
          onCancel={() => setTyping(false)}
        />
      ) : (
        <>
          <div className="min-w-0 flex-1 basis-72">
            <p>
              <span className="font-medium">Weekly weigh-in.</span> <span className="text-muted">{dueLine(due)}</span>
            </p>
            {weigh.phase === "failed" && <Result ok={false}>{weigh.message}</Result>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* The scale, or connecting one (its picker, then the weigh-in), where there's Bluetooth. */}
            {device.bluetooth && (
              <button className={button.smallPrimary} onClick={() => startWeigh(!device.scale)}>
                {device.scale ? "Weigh in" : "Connect a scale"}
              </button>
            )}
            <button className={device.bluetooth ? button.small : button.smallPrimary} onClick={() => setTyping(true)}>
              Type it in
            </button>
            <TextButton onClick={skip}>Not this week</TextButton>
          </div>
        </>
      )}
    </section>
  );
}

function dueLine(due: WeighInDue) {
  const ago = due.due && due.daysSince !== null ? `Last one was ${due.daysSince} days ago. ` : "";
  return `${ago}Weigh in before this week's first ride so watts per kilo stays right.`;
}

/** A weight typed in, saved as a weigh-in like the scale's. */
function TypedWeight({ onSaved, onCancel }: { onSaved: (kg: number) => void; onCancel: () => void }) {
  const units = useUnits();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const kg = weightToKg(Number(value), units);
    if (!(kg >= 20 && kg <= 300)) return setError("Enter your weight.");
    setSaving(true);
    const saved = await saveWeighIn({ measuredAt: new Date().toISOString(), weightKg: kg, impedance: {}, source: "manual" });
    setSaving(false);
    if (saved.ok) onSaved(kg);
    else setError(saved.message);
  };
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-3">
      <span className="font-medium">Weekly weigh-in</span>
      <label className="flex items-center gap-2">
        <input className={`${input} w-24`} inputMode="decimal" autoFocus value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Weight in ${weightUnit(units)}`} />
        <span className="text-muted">{weightUnit(units)}</span>
      </label>
      <button className={button.smallPrimary} disabled={saving}>
        Save
      </button>
      <TextButton onClick={onCancel}>Cancel</TextButton>
      {error && <Result ok={false}>{error}</Result>}
    </form>
  );
}

const TextButton = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button type="button" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={onClick}>
    {children}
  </button>
);

/** The Monday of the week the weekly weigh-in was put off, if any. */
function readSkip(): string | null {
  try {
    return localStorage.getItem(WEIGH_SKIP);
  } catch {
    return null;
  }
}

function writeSkip(monday: string) {
  try {
    localStorage.setItem(WEIGH_SKIP, monday);
  } catch {}
}
