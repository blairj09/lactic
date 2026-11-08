// Getting your data out: one ride as a FIT file (for Garmin Connect, Strava, TrainingPeaks and the
// rest), or everything as a zip of FIT files, a rides CSV and every table as JSON. Nothing here is
// sent anywhere; files go where the rider saves them.

import { strToU8, zipSync } from "fflate";
import { encodeRideFit } from "@/lib/fit/encode";
import { TABLES } from "~/db/schema";
import { sql, type Row } from "~/db/sql";
import { decode } from "~/db/supa";
import { invoke, isDesktop } from "~/platform/native";

interface RideRow {
  id: string;
  name: string | null;
  started_at: string;
  duration_seconds: number;
  source: string;
}

interface StreamRow {
  step_seconds: number;
  watts: string | null;
  heart_rate: string | null;
  cadence: string | null;
  route: string | null;
}

const parse = <T>(text: string | null | undefined): T | null => {
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/** A file name that works on every OS. */
export function safeName(name: string) {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Ride"
  );
}

function rideFileName(ride: RideRow) {
  return `${ride.started_at.slice(0, 10)} ${safeName(ride.name ?? "Ride")}.fit`;
}

function fitFor(ride: RideRow, stream: StreamRow | undefined): Uint8Array | null {
  if (!stream) return null;
  const watts = parse<number[]>(stream.watts) ?? [];
  const heartRate = parse<number[]>(stream.heart_rate) ?? [];
  const cadence = parse<number[]>(stream.cadence) ?? [];
  if (!watts.length && !heartRate.length && !cadence.length) return null;
  const route = parse<[number, number, number?][]>(stream.route);
  return encodeRideFit({
    startedAt: new Date(ride.started_at),
    stepSeconds: stream.step_seconds || 1,
    watts: watts.map((v) => v ?? 0),
    heartRate: heartRate.map((v) => v ?? 0),
    cadence: cadence.map((v) => v ?? 0),
    indoor: !route?.length,
    route,
  });
}

/** One ride as a FIT file, or null when it has no samples to write. */
export async function rideFit(activityId: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  const [ride] = (await sql().select("select id, name, started_at, duration_seconds, source from activities where id = ?", [activityId])) as unknown as RideRow[];
  if (!ride) return null;
  const [stream] = (await sql().select("select step_seconds, watts, heart_rate, cadence, route from activity_streams where activity_id = ?", [activityId])) as unknown as StreamRow[];
  const bytes = fitFor(ride, stream);
  return bytes && { name: rideFileName(ride), bytes };
}

/** Rows as JSON values: JSON columns parsed, booleans as booleans. Keys never leave. */
function tableJson(table: string, rows: Row[]) {
  const columns = TABLES[table].columns;
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (table === "intervals_connections" && key === "api_key") out[key] = String(value ?? "").startsWith("keychain:") ? value : "(removed)";
      else out[key] = decode(columns[key], value);
    }
    return out;
  });
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const RIDE_COLUMNS = ["started_at", "name", "source", "duration_seconds", "distance_meters", "average_power", "normalized_power", "intensity_factor", "training_stress", "average_hr", "ftp_used", "duplicate_of", "id"];

/** Tables left out of the export: only a hash of the Apple Health shortcut's token. */
const SKIP = new Set(["ingest_tokens"]);

const README = `Your Lactic data

rides/        Each ride with recorded samples as a FIT file. Garmin Connect, Strava,
              TrainingPeaks, intervals.icu and most training apps import these.
rides.csv     One line per ride: date, name, source, duration, power, stress and heart rate.
tables/       Every table in Lactic's database as JSON: plan, workouts, recovery, weight,
              coach chats and settings. API keys aren't included; they stay in your keychain.

For a copy Lactic itself can open, use Settings > Your data > Back up.
`;

/** Everything as a zip. */
export async function exportEverything(): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = { "README.txt": strToU8(README) };
  const tables: Record<string, Row[]> = {};
  for (const table of Object.keys(TABLES)) {
    if (SKIP.has(table)) continue;
    tables[table] = await sql().select(`select * from "${table}"`);
    files[`tables/${table}.json`] = strToU8(JSON.stringify(tableJson(table, tables[table]), null, 1));
  }

  const rides = tables.activities as unknown as (RideRow & Row)[];
  const streams = new Map((tables.activity_streams as unknown as (StreamRow & { activity_id: string })[]).map((s) => [s.activity_id, s]));
  const taken = new Set<string>();
  for (const ride of rides) {
    const bytes = fitFor(ride, streams.get(ride.id));
    if (!bytes) continue;
    let name = rideFileName(ride);
    for (let n = 2; taken.has(name); n++) name = rideFileName(ride).replace(/\.fit$/, ` (${n}).fit`);
    taken.add(name);
    files[`rides/${name}`] = bytes;
  }
  const sorted = [...rides].sort((a, b) => a.started_at.localeCompare(b.started_at));
  files["rides.csv"] = strToU8([RIDE_COLUMNS.join(","), ...sorted.map((r) => RIDE_COLUMNS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n");

  // FIT and JSON barely shrink further, but zipping keeps the download one file.
  return zipSync(files, { level: 6 });
}

function base64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Asks where to save, then writes the file. Returns the path, or null if the rider cancelled. */
export async function saveBytes(defaultName: string, bytes: Uint8Array, filter: { name: string; extensions: string[] }): Promise<string | null> {
  if (!isDesktop) {
    // Browser development: a normal download.
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const a = Object.assign(document.createElement("a"), { href: url, download: defaultName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const to = await save({ defaultPath: defaultName, filters: [filter] });
  if (!to) return null;
  await invoke("file_write_base64", { path: to, data: base64(bytes) });
  return to;
}
