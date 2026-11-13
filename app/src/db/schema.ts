// The desktop database, table by table. It mirrors the web app's Postgres schema (supabase/
// migrations) column for column, so the web app's loaders run unchanged on SQLite through
// supa.ts. Lactic's own tables follow at the end.
//
// Sync-ready from the start: every row has a stable key (a UUID, or a natural key such as a day)
// and an updated_at, so a phone app can sync later without a migration.

export type ColumnType = "uuid" | "text" | "int" | "num" | "bool" | "json" | "array" | "date" | "ts" | "time";

export interface Column {
  type: ColumnType;
  notNull?: boolean;
  /** "uuid": a new UUID. "now": the current time. "user": the one local user. Anything else: a literal. */
  default?: "uuid" | "now" | "user" | string | number | boolean | object;
}

export interface ForeignKey {
  table: string;
  column: string;
  onDelete: "cascade" | "set null";
}

export interface Table {
  columns: Record<string, Column>;
  primaryKey: string[];
  unique?: string[][];
  foreignKeys?: Record<string, ForeignKey>;
  indexes?: string[][];
}

/** The one local user. user_id columns stay so the web app's queries and conflict targets work as written. */
export const LOCAL_USER = "00000000-0000-4000-8000-000000000001";

const id: Column = { type: "uuid", notNull: true, default: "uuid" };
const user: Column = { type: "uuid", notNull: true, default: "user" };
const now: Column = { type: "ts", notNull: true, default: "now" };
const activity = (onDelete: ForeignKey["onDelete"]): ForeignKey => ({ table: "activities", column: "id", onDelete });

export const TABLES: Record<string, Table> = {
  athlete_settings: {
    columns: {
      user_id: user,
      ftp_watts: { type: "int" },
      weight_kg: { type: "num" },
      max_hr: { type: "int" },
      sleep_need_hours: { type: "num", notNull: true, default: 8 },
      timezone: { type: "text", notNull: true, default: "UTC" },
      updated_at: now,
      threshold_hr: { type: "int" },
      height_cm: { type: "num" },
      birth_date: { type: "date" },
      sex: { type: "text" },
      availability: { type: "json", notNull: true, default: [0, 60, 60, 60, 0, 120, 90] },
      ramp_rate: { type: "num", notNull: true, default: 5 },
    },
    primaryKey: ["user_id"],
  },
  // The web app's Apple Health shortcut token; unused here but read by shared loaders.
  ingest_tokens: {
    columns: { user_id: user, token_hash: { type: "text", notNull: true }, created_at: now, last_used_at: { type: "ts" }, updated_at: now },
    primaryKey: ["user_id"],
  },
  ftp_history: {
    columns: {
      id,
      user_id: user,
      effective_date: { type: "date", notNull: true },
      watts: { type: "int", notNull: true },
      method: { type: "text", notNull: true },
      w_prime_joules: { type: "int" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    indexes: [["effective_date"]],
  },
  activities: {
    columns: {
      id,
      user_id: user,
      source: { type: "text", notNull: true },
      external_id: { type: "text" },
      name: { type: "text" },
      sport: { type: "text", notNull: true, default: "ride" },
      started_at: { type: "ts", notNull: true },
      duration_seconds: { type: "int", notNull: true },
      distance_meters: { type: "num" },
      average_power: { type: "num" },
      normalized_power: { type: "num" },
      intensity_factor: { type: "num" },
      training_stress: { type: "num" },
      average_hr: { type: "num" },
      power_curve: { type: "json" },
      duplicate_of: { type: "uuid" },
      file_path: { type: "text" },
      created_at: now,
      stress_method: { type: "text" },
      ftp_used: { type: "int" },
      power_histogram: { type: "array" },
      intervals_id: { type: "text" },
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["user_id", "source", "external_id"]],
    foreignKeys: { duplicate_of: activity("set null") },
    indexes: [["started_at"], ["duplicate_of"]],
  },
  activity_streams: {
    columns: {
      activity_id: { type: "uuid", notNull: true },
      user_id: user,
      step_seconds: { type: "int", notNull: true, default: 5 },
      watts: { type: "array" },
      heart_rate: { type: "array" },
      cadence: { type: "array" },
      target: { type: "array" },
      workout: { type: "json" },
      intervals: { type: "json" },
      created_at: now,
      route: { type: "json" },
      updated_at: now,
      /** Changes adaptive workouts made mid-ride, and how each ended (web/lib/ride/adapt.ts). */
      adaptations: { type: "json" },
    },
    primaryKey: ["activity_id"],
    foreignKeys: { activity_id: activity("cascade") },
  },
  body_measurements: {
    columns: {
      id,
      user_id: user,
      measured_at: { type: "ts", notNull: true },
      source: { type: "text", notNull: true, default: "body_pod" },
      weight_kg: { type: "num", notNull: true },
      bmi: { type: "num" },
      body_fat_pct: { type: "num" },
      fat_free_mass_kg: { type: "num" },
      impedance: { type: "json" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["user_id", "measured_at"]],
    indexes: [["measured_at"]],
  },
  coach_conversations: {
    columns: {
      id,
      user_id: user,
      title: { type: "text", notNull: true, default: "" },
      summary: { type: "text", notNull: true, default: "" },
      summarized_through: { type: "ts" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    indexes: [["updated_at"]],
  },
  coach_memory: {
    columns: {
      id,
      user_id: user,
      fact: { type: "text", notNull: true },
      source: { type: "text", notNull: true, default: "coach" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  coach_messages: {
    columns: {
      id,
      user_id: user,
      role: { type: "text", notNull: true },
      content: { type: "text", notNull: true },
      proposals: { type: "json", notNull: true, default: [] },
      model: { type: "text" },
      created_at: now,
      kind: { type: "text", notNull: true, default: "chat" },
      day: { type: "date" },
      meta: { type: "json", notNull: true, default: {} },
      conversation_id: { type: "uuid" },
      attachments: { type: "json" },
      updated_at: now,
    },
    primaryKey: ["id"],
    foreignKeys: { conversation_id: { table: "coach_conversations", column: "id", onDelete: "cascade" } },
    indexes: [["conversation_id", "created_at"], ["kind", "day"]],
  },
  coach_persona: {
    columns: {
      user_id: user,
      name: { type: "text", notNull: true, default: "Coach" },
      tone: { type: "text", notNull: true, default: "direct" },
      detail: { type: "text", notNull: true, default: "balanced" },
      instructions: { type: "text", notNull: true, default: "" },
      updated_at: now,
    },
    primaryKey: ["user_id"],
  },
  coach_picks: {
    columns: {
      user_id: user,
      day: { type: "date", notNull: true },
      template: { type: "text", notNull: true },
      tweaks: { type: "json", notNull: true, default: {} },
      reason: { type: "text", notNull: true, default: "" },
      model: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["user_id", "day"],
  },
  custom_workouts: {
    columns: {
      id,
      user_id: user,
      name: { type: "text", notNull: true },
      segments: { type: "json", notNull: true },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  /** Workouts the rider favorited: `library:<id>` for the starter library, `custom:<id>` for My workouts. */
  workout_favorites: {
    columns: {
      id,
      user_id: user,
      workout_key: { type: "text", notNull: true },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["user_id", "workout_key"]],
  },
  health_days: {
    columns: {
      user_id: user,
      day: { type: "date", notNull: true },
      hr_minutes: { type: "array" },
      active_kcal: { type: "num" },
      steps: { type: "int" },
      vo2max: { type: "num" },
      updated_at: now,
      source: { type: "text", notNull: true, default: "apple_health" },
    },
    primaryKey: ["user_id", "day"],
  },
  intervals_connections: {
    columns: {
      user_id: user,
      athlete_id: { type: "text", notNull: true },
      // The key itself lives in the system keychain; this column stays for the web code's shape.
      api_key: { type: "text", notNull: true, default: "keychain" },
      newest_synced_local: { type: "text" },
      backfill_before_local: { type: "text" },
      backfill_done: { type: "bool", notNull: true, default: false },
      connected_at: now,
      last_synced_at: { type: "ts" },
      upload_rides: { type: "bool", default: true },
      // Rides in the last two years that reached intervals.icu from Strava and aren't here (its API can't share them).
      strava_missing: { type: "int" },
      strava_missing_oldest: { type: "text" },
      strava_missing_newest: { type: "text" },
      updated_at: now,
    },
    primaryKey: ["user_id"],
  },
  intervals_uploads: {
    columns: {
      activity_id: { type: "uuid", notNull: true },
      user_id: user,
      fit_base64: { type: "text" },
      status: { type: "text", notNull: true, default: "pending" },
      intervals_id: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["activity_id"],
    foreignKeys: { activity_id: activity("cascade") },
  },
  outdoor_rides: {
    columns: { user_id: user, day: { type: "date", notNull: true }, workout: { type: "json" }, created_at: now, updated_at: now },
    primaryKey: ["user_id", "day"],
  },
  plan_breaks: {
    columns: {
      id,
      user_id: user,
      start_date: { type: "date", notNull: true },
      end_date: { type: "date", notNull: true },
      kind: { type: "text", notNull: true },
      riding: { type: "text", notNull: true },
      minutes: { type: "int" },
      note: { type: "text", notNull: true, default: "" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  plan_days: {
    columns: {
      user_id: user,
      day: { type: "date", notNull: true },
      planned: { type: "json" },
      chosen: { type: "json" },
      checkin: { type: "json" },
      activity_id: { type: "uuid" },
      feel_after: { type: "int" },
      // A missed key session moved to this day: the day it was planned for.
      moved_from: { type: "date" },
      updated_at: now,
    },
    primaryKey: ["user_id", "day"],
    foreignKeys: { activity_id: activity("set null") },
  },
  // Each week's plan as it stood when the week began (engine/stability.ts), so it stays put as the rides come in.
  plan_weeks: {
    columns: { user_id: user, week: { type: "date", notNull: true }, days: { type: "json", notNull: true, default: [] }, inputs: { type: "text" }, created_at: now, updated_at: now },
    primaryKey: ["user_id", "week"],
  },
  plan_snapshots: {
    columns: { user_id: user, week: { type: "date", notNull: true }, days: { type: "json", notNull: true, default: [] }, created_at: now, updated_at: now },
    primaryKey: ["user_id", "week"],
  },
  recovery_days: {
    columns: {
      user_id: user,
      day: { type: "date", notNull: true },
      hrv_ms: { type: "num" },
      hrv_kind: { type: "text" },
      resting_hr: { type: "num" },
      sleep_hours: { type: "num" },
      source: { type: "text", notNull: true, default: "shortcut" },
      score: { type: "int" },
      reasons: { type: "json", notNull: true, default: [] },
      updated_at: now,
      sleep_deep_hours: { type: "num" },
      sleep_rem_hours: { type: "num" },
      sleep_core_hours: { type: "num" },
      sleep_awake_hours: { type: "num" },
      sleep_start: { type: "ts" },
      sleep_end: { type: "ts" },
      wrist_temp_c: { type: "num" },
      respiratory_rate: { type: "num" },
      sleep_segments: { type: "json" },
      skin_temp_raw: { type: "num" },
    },
    primaryKey: ["user_id", "day"],
  },
  ride_feedback: {
    columns: {
      activity_id: { type: "uuid", notNull: true },
      user_id: user,
      difficulty: { type: "text", notNull: true },
      rpe: { type: "int" },
      note: { type: "text", notNull: true, default: "" },
      session: { type: "json" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["activity_id"],
    foreignKeys: { activity_id: activity("cascade") },
  },
  training_goals: {
    columns: {
      id,
      user_id: user,
      name: { type: "text", notNull: true },
      event_date: { type: "date", notNull: true },
      priority: { type: "text", notNull: true },
      kind: { type: "text", notNull: true },
      created_at: now,
      duration_minutes: { type: "int" },
      intensity: { type: "text" },
      start_time: { type: "time" },
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  training_plans: {
    columns: {
      id,
      user_id: user,
      name: { type: "text", notNull: true },
      start_date: { type: "date", notNull: true },
      end_date: { type: "date", notNull: true },
      goal: { type: "text", notNull: true },
      goal_id: { type: "uuid" },
      target: { type: "num" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    foreignKeys: { goal_id: { table: "training_goals", column: "id", onDelete: "set null" } },
  },

  // Lactic's own tables.

  /** Small settings by key: onboarding, the coach mode and AI setup, source priority, units. */
  app_settings: {
    columns: { key: { type: "text", notNull: true }, value: { type: "json" }, updated_at: now },
    primaryKey: ["key"],
  },
  /** Each integration the rider set up: what it is, its settings and how its last sync went. */
  integrations: {
    columns: {
      id: { type: "text", notNull: true },
      enabled: { type: "bool", notNull: true, default: true },
      config: { type: "json", notNull: true, default: {} },
      status: { type: "text" },
      last_sync_at: { type: "ts" },
      last_error: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  /** Model calls, for the cost view and the monthly cap. */
  ai_usage: {
    columns: {
      id,
      at: now,
      provider: { type: "text", notNull: true },
      model: { type: "text", notNull: true },
      job: { type: "text", notNull: true },
      input_tokens: { type: "int", notNull: true, default: 0 },
      output_tokens: { type: "int", notNull: true, default: 0 },
      cost_usd: { type: "num" },
      updated_at: now,
    },
    primaryKey: ["id"],
    indexes: [["at"]],
  },
  /**
   * A race's review: the rider's own GPS track at full detail (their ride file, from intervals.icu or
   * dropped in), the official results pasted or read off a screenshot, and the coach's debrief.
   */
  race_reviews: {
    columns: {
      id,
      user_id: user,
      activity_id: { type: "uuid", notNull: true },
      own_track: { type: "json" },
      own_name: { type: "text" },
      results_text: { type: "text" },
      notes: { type: "text" },
      debrief: { type: "text" },
      debrief_rival: { type: "text" },
      debrief_at: { type: "ts" },
      /** Named places on a race that isn't laps, one per line ("Montpelier 122"). */
      places_text: { type: "text" },
      /** The event (training_goals) this race was, once the report has been opened for it. */
      goal_id: { type: "uuid" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["activity_id"]],
    foreignKeys: { activity_id: activity("cascade") },
  },
  /**
   * An event's course, from a file the rider attached (GPX, TCX or FIT): the track thinned to every
   * 10 m or so, the profile summary the plan uses, and the latest forecast for race day.
   */
  event_courses: {
    columns: {
      id,
      user_id: user,
      goal_id: { type: "uuid", notNull: true },
      file_name: { type: "text" },
      track: { type: "json", notNull: true },
      summary: { type: "json", notNull: true },
      /** "file" when the heights came with it, "terrain" when Lactic looked them up. */
      elevation_source: { type: "text" },
      forecast: { type: "json" },
      forecast_at: { type: "ts" },
      created_at: now,
      updated_at: now,
      /** A finish time the rider is aiming for, seconds. */
      target_seconds: { type: "int" },
      /** How it's ridden: "solo", "group" or "bunch"; the event kind's usual when null. */
      pack: { type: "text" },
    },
    primaryKey: ["id"],
    unique: [["goal_id"]],
    foreignKeys: { goal_id: { table: "training_goals", column: "id", onDelete: "cascade" } },
  },
  /** Other riders' tracks of a race (GPX files from Strava), to compare against. */
  race_rivals: {
    columns: {
      id,
      user_id: user,
      activity_id: { type: "uuid", notNull: true },
      name: { type: "text", notNull: true },
      track: { type: "json", notNull: true },
      /** "past" for one of the rider's own earlier rides of the course; null for another rider. */
      kind: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    foreignKeys: { activity_id: activity("cascade") },
    indexes: [["activity_id"]],
  },
  /** Plan changes proposed by an external coach over MCP, waiting in the app for the rider. */
  coach_proposals: {
    columns: {
      id,
      source: { type: "text", notNull: true, default: "mcp" },
      client: { type: "text" },
      proposal: { type: "json", notNull: true },
      note: { type: "text", notNull: true, default: "" },
      status: { type: "text", notNull: true, default: "pending" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
  },
  /** The rider's Strava, for posting rides recorded here. The tokens live in the keychain (src-tauri/src/strava.rs). */
  strava_connections: {
    columns: {
      user_id: user,
      athlete_id: { type: "text", notNull: true },
      athlete_name: { type: "text", notNull: true, default: "" },
      scope: { type: "text", notNull: true, default: "" },
      upload_rides: { type: "bool", notNull: true, default: true },
      // Set when Strava turned a token refresh down: the rider has to connect again.
      needs_reconnect: { type: "bool", notNull: true, default: false },
      connected_at: now,
      updated_at: now,
    },
    primaryKey: ["user_id"],
  },
  /** Rides recorded here on their way to Strava. pending → sending → processing (Strava has the file) → sent, or skipped/failed. */
  strava_uploads: {
    columns: {
      activity_id: { type: "uuid", notNull: true },
      user_id: user,
      fit_base64: { type: "text" },
      status: { type: "text", notNull: true, default: "pending" },
      upload_id: { type: "text" },
      strava_id: { type: "text" },
      error: { type: "text" },
      tries: { type: "int", notNull: true, default: 0 },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["activity_id"],
    foreignKeys: { activity_id: activity("cascade") },
  },
  /**
   * The rider's layouts (web/lib/sdk/layout.ts): tabs, Today's cards and ride field pages, one
   * active per device ("desktop" or "phone"). `layout` is checked by parseLayout() on every load.
   * No row means the default layout, so a rider who never customizes has none.
   */
  layouts: {
    columns: {
      id,
      user_id: user,
      device: { type: "text", notNull: true, default: "desktop" },
      name: { type: "text", notNull: true, default: "My layout" },
      layout: { type: "json", notNull: true },
      active: { type: "bool", notNull: true, default: true },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    indexes: [["device", "active"]],
  },
  /**
   * Installed plugins (src/plugins): the checked manifest and the plugin's code, pinned by its
   * SHA-256. Whether a plugin runs is decided per device in plugin_grants (review S7), so a row
   * that arrives by sync or a restored backup runs nowhere until the rider approves it there.
   */
  plugins: {
    columns: {
      id,
      plugin_id: { type: "text", notNull: true },
      name: { type: "text", notNull: true },
      version: { type: "text", notNull: true },
      manifest: { type: "json", notNull: true },
      source: { type: "text", notNull: true },
      sha256: { type: "text", notNull: true },
      /** Where it came from, for update checks: "github:owner/repo", or null for a chosen file. */
      origin: { type: "text" },
      installed_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["plugin_id"]],
  },
  /**
   * The rider's approval of one plugin on one device: which exact code (sha256), which permission
   * groups, switched on, and whether the coach may see its numbers (off by default). `device` is a
   * random id kept outside the database (src/plugins/device.ts).
   */
  plugin_grants: {
    columns: {
      id,
      plugin_id: { type: "text", notNull: true },
      device: { type: "text", notNull: true },
      sha256: { type: "text", notNull: true },
      read: { type: "json", notNull: true, default: [] },
      enabled: { type: "bool", notNull: true, default: true },
      coach_visible: { type: "bool", notNull: true, default: false },
      /** Plain-words reason when Lactic switched it off (crashes, running late). */
      switched_off: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["plugin_id", "device"]],
  },
  /**
   * What a plugin's ride analysis drew for one saved ride (a checked kit tree), keyed to the exact
   * package that made it, so a changed plugin runs again. Removed with the plugin or the ride.
   */
  plugin_analyses: {
    columns: {
      id,
      plugin_id: { type: "text", notNull: true },
      analysis: { type: "text", notNull: true },
      activity_id: { type: "uuid", notNull: true },
      sha256: { type: "text", notNull: true },
      tree: { type: "json" },
      /** Plain-words reason when it didn't produce anything. */
      failed: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    unique: [["plugin_id", "analysis", "activity_id"]],
    foreignKeys: { activity_id: activity("cascade") },
    indexes: [["activity_id"]],
  },
  /** Numbers a plugin published, per day and optionally per ride. Capped per plugin (review S10). */
  plugin_values: {
    columns: {
      id,
      plugin_id: { type: "text", notNull: true },
      metric: { type: "text", notNull: true },
      day: { type: "date", notNull: true },
      activity_id: { type: "uuid" },
      value: { type: "num" },
      choice: { type: "text" },
      created_at: now,
      updated_at: now,
    },
    primaryKey: ["id"],
    indexes: [["metric", "day"], ["plugin_id", "created_at"]],
  },
};

const SQL_TYPE: Record<ColumnType, string> = {
  uuid: "TEXT",
  text: "TEXT",
  int: "INTEGER",
  num: "REAL",
  bool: "INTEGER",
  json: "TEXT",
  array: "TEXT",
  date: "TEXT",
  ts: "TEXT",
  time: "TEXT",
};

const NOW_SQL = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

function defaultSql(c: Column): string | null {
  if (c.default === undefined || c.default === "uuid") return null; // UUIDs are made in supa.ts.
  if (c.default === "now") return NOW_SQL;
  if (c.default === "user") return `'${LOCAL_USER}'`;
  if (typeof c.default === "number") return String(c.default);
  if (typeof c.default === "boolean") return c.default ? "1" : "0";
  const text = typeof c.default === "string" ? c.default : JSON.stringify(c.default);
  return `'${text.replace(/'/g, "''")}'`;
}

export function columnSql(name: string, c: Column): string {
  const parts = [`"${name}"`, SQL_TYPE[c.type]];
  if (c.notNull) parts.push("NOT NULL");
  const d = defaultSql(c);
  if (d) parts.push(`DEFAULT ${d}`);
  return parts.join(" ");
}

export function createTableSql(name: string, t: Table): string[] {
  const lines = Object.entries(t.columns).map(([n, c]) => columnSql(n, c));
  lines.push(`PRIMARY KEY (${t.primaryKey.map((k) => `"${k}"`).join(", ")})`);
  for (const u of t.unique ?? []) lines.push(`UNIQUE (${u.map((k) => `"${k}"`).join(", ")})`);
  for (const [col, fk] of Object.entries(t.foreignKeys ?? {}))
    lines.push(`FOREIGN KEY ("${col}") REFERENCES "${fk.table}" ("${fk.column}") ON DELETE ${fk.onDelete.toUpperCase()}`);
  const out = [`CREATE TABLE IF NOT EXISTS "${name}" (\n  ${lines.join(",\n  ")}\n)`];
  for (const idx of t.indexes ?? []) out.push(`CREATE INDEX IF NOT EXISTS "${name}_${idx.join("_")}" ON "${name}" (${idx.map((k) => `"${k}"`).join(", ")})`);
  return out;
}
