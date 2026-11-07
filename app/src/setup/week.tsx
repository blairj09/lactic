// Your week and your goal: how long you can ride each day, and what the plan builds toward.
// Saved through the Plan page's own actions, so the plan is the same one Plan shows and edits.

import { saveAvailability, saveGoal, savePlan } from "@/app/plan/actions";
import { Field, Result, Segmented, input } from "@/components/ui";
import { DEFAULT_AVAILABILITY, GOAL_KIND_LABELS, GOAL_KINDS, type Availability, type GoalKind } from "@/lib/engine/plan";
import { createClient } from "~/db/supabase-client";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHOICES = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240];

export type GoalChoice = "event" | "ftp" | "fitness" | "base";

export interface WeekValues {
  availability: Availability;
  goal: GoalChoice;
  eventName: string;
  eventDate: string;
  eventKind: GoalKind;
  eventHours: string;
  weeks: number;
}

export const defaultWeek = (): WeekValues => ({
  availability: [...DEFAULT_AVAILABILITY] as Availability,
  goal: "ftp",
  eventName: "",
  eventDate: "",
  eventKind: "granFondo",
  eventHours: "4",
  weeks: 12,
});

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hours = (m: number) => (m === 0 ? "Rest" : m < 60 ? `${m} min` : `${m % 60 ? (m / 60).toFixed(m % 30 ? 2 : 1) : m / 60} h`);

export function WeekForm({ values: v, onChange, error }: { values: WeekValues; onChange: (v: WeekValues) => void; error?: string | null }) {
  const set = <K extends keyof WeekValues>(k: K, value: WeekValues[K]) => onChange({ ...v, [k]: value });
  const total = v.availability.reduce((a, b) => a + b, 0) / 60;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="font-medium">When can you ride?</h3>
          <span className="num text-sm text-muted">{total.toFixed(1)} h a week</span>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="space-y-1.5 text-center">
              <span className="block text-xs font-medium text-muted">{d}</span>
              <select
                className={`${input} w-full px-1 text-center`}
                value={v.availability[i]}
                onChange={(e) => {
                  const next = [...v.availability] as Availability;
                  next[i] = Number(e.target.value);
                  set("availability", next);
                }}
              >
                {CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {hours(m)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="text-sm text-muted">The plan never schedules more than this. Change it any time on the Plan page.</p>
      </section>

      <section className="space-y-4">
        <h3 className="font-medium">What are you training for?</h3>
        <Segmented
          label="Goal"
          fill
          wrap
          value={v.goal}
          onChange={(g) => set("goal", g)}
          options={[
            { value: "event", label: "An event" },
            { value: "ftp", label: "Raise my FTP" },
            { value: "fitness", label: "Get fitter" },
            { value: "base", label: "Stay consistent" },
          ]}
        />
        {v.goal === "event" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Event">
              <input className={`${input} w-full`} value={v.eventName} onChange={(e) => set("eventName", e.target.value)} placeholder="Spring gran fondo" />
            </Field>
            <Field label="Date">
              <input type="date" className={`${input} w-44`} min={iso(new Date(Date.now() + 14 * 86_400_000))} value={v.eventDate} onChange={(e) => set("eventDate", e.target.value)} />
            </Field>
            <Field label="Kind">
              <select className={`${input} w-full`} value={v.eventKind} onChange={(e) => set("eventKind", e.target.value as GoalKind)}>
                {GOAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {GOAL_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How long will it take you?">
              <div className="relative w-28">
                <input className={`${input} w-full pr-8`} inputMode="decimal" value={v.eventHours} onChange={(e) => set("eventHours", e.target.value.replace(/[^\d.]/g, ""))} />
                <span className="pointer-events-none absolute top-2 right-3 text-sm text-muted">h</span>
              </div>
            </Field>
          </div>
        ) : (
          <div className="space-y-2"><span className="block text-sm font-medium">Plan length</span>
            <Segmented
              label="Plan length"
              value={v.weeks}
              onChange={(w) => set("weeks", w)}
              options={[8, 12, 16, 24].map((w) => ({ value: w, label: `${w} weeks` }))}
            />
          <span className="block text-sm text-muted">Plans run in blocks with a recovery week every few weeks. You can extend it later.</span></div>
        )}
      </section>
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

const PLAN_GOAL: Record<GoalChoice, string> = { event: "event", ftp: "ftp", fitness: "fitness", base: "base" };

/** Saves availability, the event (if any) and the plan. */
export async function saveWeek(v: WeekValues) {
  const av = new FormData();
  v.availability.forEach((m, i) => av.set(`day${i}`, String(m)));
  av.set("ramp_rate", "5");
  const a = await saveAvailability(null, av);
  if (!a.ok) return a;

  const start = iso(new Date());
  const plan = new FormData();
  plan.set("goal", PLAN_GOAL[v.goal]);
  plan.set("start", start);
  if (v.goal === "event") {
    if (!v.eventName.trim()) return { ok: false as const, message: "Give your event a name." };
    if (!v.eventDate) return { ok: false as const, message: "Pick the event date." };
    const ev = new FormData();
    ev.set("name", v.eventName.trim());
    ev.set("date", v.eventDate);
    ev.set("priority", "A");
    ev.set("kind", v.eventKind);
    ev.set("minutes", String(Math.round(Number(v.eventHours || 3) * 60)));
    ev.set("intensity", "moderate");
    const g = await saveGoal(null, ev);
    if (!g.ok) return g;
    const { data } = await createClient().from("training_goals").select("id").eq("event_date", v.eventDate).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return { ok: false as const, message: "Couldn't find the event just saved." };
    plan.set("goal_id", data.id);
  } else {
    plan.set("end", iso(new Date(Date.now() + (v.weeks * 7 - 1) * 86_400_000)));
  }
  // Onboarding owns the first plan: replace one left from an earlier try.
  const { data: existing } = await createClient().from("training_plans").select("id").limit(1).maybeSingle();
  if (existing) plan.set("id", existing.id);
  return savePlan(null, plan);
}
