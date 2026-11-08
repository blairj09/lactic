// Apple Health, which only lives on the iPhone: a Shortcut (or the Health Auto Export app) saves
// a JSON file into iCloud Drive/Lactic each morning, and Lactic imports whatever lands there.
// The files use the same formats the web app's /api/health took, parsed by the same engine code.

import { autoExportSamples, columnDaySamples, columnSamples, healthDays, healthNights } from "@/lib/engine/health-import";
import { createClient } from "~/db/supabase-client";
import { invoke, isDesktop } from "~/platform/native";
import { getSetting, setSetting } from "~/settings/store";
import { revalidatePath } from "~/shims/next-cache";
import { provideRecoverySetup } from "@/lib/recovery-source";
import { registerJob } from "./background";

export const SOURCE = "apple_health";
const FOLDER_SETTING = "health.folder";
/** The source picked in Sleep and recovery setup: "apple", or "watch" / "android" (both through intervals.icu). */
export const SOURCE_SETTING = "health.source";

// Today names the rider's recovery source from this.
provideRecoverySetup(async () => {
  const [picked, last] = await Promise.all([
    getSetting<string | null>(SOURCE_SETTING, null),
    getSetting<{ nights: number; days: number } | null>("health.lastImport", null),
  ]);
  return {
    picked: picked === "apple" ? "apple" : picked === "watch" || picked === "android" ? "intervals" : null,
    appleReceiving: Boolean(last && (last.nights > 0 || last.days > 0)),
  };
});

interface Entry {
  name: string;
  path: string;
  modifiedMs: number;
  size: number;
  isDir: boolean;
}

export interface IngestResult {
  nights: number;
  days: number;
  latest: string | null;
}

const num = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Writes one body (any of the accepted shapes) into recovery_days and health_days. */
export async function ingestHealth(body: Record<string, unknown>): Promise<IngestResult> {
  const supabase = createClient();
  const out: IngestResult = { nights: 0, days: 0, latest: null };

  const exported = autoExportSamples(body);
  const columns = exported ?? columnSamples(body);
  const nightInput = columns ?? ("sleep" in body || "restingHr" in body || (typeof body.hrv === "string" && body.hrv.includes("|")) ? body : null);
  const kind = exported ? "sdnn" : String(body.hrvKind ?? "sdnn").trim().toLowerCase() === "rmssd" ? "rmssd" : "sdnn";

  if (nightInput) {
    const nights = healthNights({
      sleep: nightInput.sleep,
      hrv: nightInput.hrv,
      restingHr: nightInput.restingHr,
      wristTemp: nightInput.wristTemp,
      respiratoryRate: nightInput.respiratoryRate,
    }).slice(-400);
    const iso = (unix: number | null) => (unix === null ? null : new Date(unix * 1000).toISOString());
    if (nights.length) {
      const { data: existing } = await supabase.from("recovery_days").select("*").in("day", nights.map((n) => n.day));
      const prior = new Map(((existing ?? []) as Record<string, unknown>[]).map((r) => [String(r.day), r]));
      const rows = nights.map((n) => {
        const was = prior.get(n.day) ?? {};
        const pick = <T>(v: T | null, key: string) => (v ?? (was[key] as T | undefined) ?? null);
        const hrv = num(n.hrv, 1, 400);
        return {
          day: n.day,
          hrv_ms: pick(hrv, "hrv_ms"),
          hrv_kind: hrv !== null ? kind : pick(null, "hrv_kind"),
          resting_hr: pick(num(n.restingHr, 25, 150), "resting_hr"),
          sleep_hours: pick(num(n.asleepHours, 0, 24), "sleep_hours"),
          sleep_deep_hours: pick(num(n.deepHours, 0, 24), "sleep_deep_hours"),
          sleep_rem_hours: pick(num(n.remHours, 0, 24), "sleep_rem_hours"),
          sleep_core_hours: pick(num(n.coreHours, 0, 24), "sleep_core_hours"),
          sleep_awake_hours: pick(num(n.awakeHours, 0, 24), "sleep_awake_hours"),
          sleep_start: pick(iso(n.start), "sleep_start"),
          sleep_end: pick(iso(n.end), "sleep_end"),
          wrist_temp_c: pick(n.wristTempC, "wrist_temp_c"),
          respiratory_rate: pick(n.respiratoryRate, "respiratory_rate"),
          sleep_segments: n.segments.length ? n.segments.map((g) => [g.start, g.end, g.stage]) : pick(null, "sleep_segments"),
          source: "shortcut",
        };
      });
      const { error } = await supabase.from("recovery_days").upsert(rows, { onConflict: "user_id,day" });
      if (error) throw new Error(error.message);
      out.nights = rows.length;
      const last = nights.at(-1)!;
      out.latest = `${last.day}: ${last.asleepHours === null ? "no sleep" : `${last.asleepHours.toFixed(1)} h asleep`}${last.hrv === null ? "" : `, HRV ${Math.round(last.hrv)} ms`}`;
    }
  }

  const daySamples = columnDaySamples(body);
  if (daySamples) {
    const days = healthDays(daySamples).slice(-400);
    if (days.length) {
      const { data: existing } = await supabase.from("health_days").select("*").in("day", days.map((d) => d.day));
      const prior = new Map(((existing ?? []) as { day: string; hr_minutes: (number | null)[] | null; active_kcal: number | null; steps: number | null; vo2max: number | null }[]).map((r) => [r.day, r]));
      const rows = days.map((d) => {
        const was = prior.get(d.day);
        const fresh = d.hrMinutes.length === 1440 && d.hrMinutes.some((v) => v !== null) ? d.hrMinutes.map((v) => (v !== null && v >= 25 && v <= 240 ? Math.round(v) : null)) : null;
        const hr = !fresh ? (was?.hr_minutes ?? null) : was?.hr_minutes?.length === 1440 ? fresh.map((v, i) => v ?? was.hr_minutes![i]) : fresh;
        const max = (a: number | null, b: number | null | undefined) => (a === null ? (b ?? null) : b == null ? a : Math.max(a, b));
        return {
          day: d.day,
          hr_minutes: hr,
          active_kcal: max(num(d.activeKcal, 0, 20000), was?.active_kcal),
          steps: max(num(d.steps, 0, 200000) === null ? null : Math.round(d.steps!), was?.steps),
          vo2max: num(d.vo2max, 10, 95) ?? was?.vo2max ?? null,
          source: SOURCE,
        };
      });
      const { error } = await supabase.from("health_days").upsert(rows, { onConflict: "user_id,day" });
      if (error) throw new Error(error.message);
      out.days = rows.length;
    }
  }
  return out;
}

// --- the iCloud Drive folder --------------------------------------------------------------------

/** iCloud Drive/Lactic, created if needed; null without iCloud Drive (or outside the app). */
export async function healthFolder(): Promise<string | null> {
  if (!isDesktop) return null;
  const custom = await getSetting<string | null>(FOLDER_SETTING, null);
  if (custom) return invoke<string>("folder_ensure", { path: custom });
  const drive = await invoke<string | null>("icloud_drive");
  return drive ? invoke<string>("folder_ensure", { path: `${drive}/Lactic` }) : null;
}

export async function setHealthFolder(path: string | null) {
  await setSetting(FOLDER_SETTING, path);
}

/** Imports every JSON file in the folder, then files it under Imported/. */
export async function importHealthFolder(): Promise<{ ok: boolean; message: string } | void> {
  const folder = await healthFolder();
  if (!folder) return;
  const entries = (await invoke<Entry[]>("folder_list", { path: folder })).filter((e) => !e.isDir && /\.(json|txt)$/i.test(e.name));
  if (!entries.length) return;
  let nights = 0;
  let days = 0;
  let latest: string | null = null;
  const failed: string[] = [];
  for (const e of entries.sort((a, b) => a.modifiedMs - b.modifiedMs)) {
    try {
      const body = JSON.parse(await invoke<string>("file_read_text", { path: e.path }));
      const r = await ingestHealth(body);
      nights += r.nights;
      days += r.days;
      latest = r.latest ?? latest;
      await invoke("file_move_into", { path: e.path, folder: `${folder}/Imported` });
    } catch (err) {
      failed.push(`${e.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (nights || days) revalidatePath("/");
  await setSetting("health.lastImport", { at: new Date().toISOString(), nights, days, latest, failed });
  return {
    ok: failed.length === 0,
    message: failed.length ? `Couldn't read ${failed.join("; ")}` : `Imported ${nights} night${nights === 1 ? "" : "s"} and ${days} day${days === 1 ? "" : "s"}${latest ? `. Latest ${latest}` : ""}.`,
  };
}

registerJob("health", importHealthFolder);
