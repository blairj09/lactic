// App history in rider words: what each changed row was and is now, and an entry's title. Plain data
// in and out, so it tests in Vitest.

import { TABLES } from "~/db/schema";
import type { Row, SqlValue } from "~/db/sql";

export interface ChangedRow {
  table: string;
  before: Row | null;
  after: Row | null;
}

export interface ChangeLine {
  /** The group it's listed under: Events, Plan, Profile, Plugins… */
  section: string;
  label: string;
  /** Null: it wasn't there (added). */
  was: string | null;
  /** Null: it's gone (removed). */
  now: string | null;
}

/** A stored value as the app reads it: JSON parsed, booleans as booleans. */
function read(table: string, col: string, raw: SqlValue | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  const type = TABLES[table]?.columns[col]?.type;
  if (type === "json" || type === "array") {
    try {
      return JSON.parse(String(raw));
    } catch {
      return null;
    }
  }
  if (type === "bool") return raw === 1 || raw === true || raw === "1";
  return raw;
}

const field = (c: ChangedRow, col: string, side: "before" | "after" = c.after ? "after" : "before") => read(c.table, col, c[side]?.[col]);
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function day(iso: unknown): string {
  const s = text(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const span = (a: unknown, b: unknown) => (text(a) === text(b) ? day(a) : `${day(a)} – ${day(b)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A planned session as the Plan page names it. */
export function sessionText(session: unknown): string {
  if (!session || typeof session !== "object") return "Rest";
  const s = session as { workout?: { name?: string }; duration?: number };
  const name = s.workout?.name ?? "Workout";
  const min = typeof s.duration === "number" ? Math.round(s.duration / 60) : null;
  return min && !/\bmin\b/.test(name) ? `${name} ${min} min` : name;
}

function weekly(availability: unknown): string {
  if (!Array.isArray(availability)) return "";
  const minutes = availability.reduce((t: number, m) => t + (typeof m === "number" ? m : 0), 0);
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} h a week`;
}

type Side = "before" | "after";

/** One line per row: a summary of what the row was and is. */
const SUMMARY: Record<string, { section: string; label: (c: ChangedRow) => string; summary: (c: ChangedRow, side: Side) => string }> = {
  training_goals: {
    section: "Events",
    label: (c) => text(field(c, "name")),
    summary: (c, s) => {
      const min = field(c, "duration_minutes", s);
      return [day(field(c, "event_date", s)), `${text(field(c, "priority", s))} priority`, min ? `${min} min` : ""].filter(Boolean).join(" · ");
    },
  },
  training_plans: {
    section: "Plans",
    label: (c) => text(field(c, "name")),
    summary: (c, s) => `${span(field(c, "start_date", s), field(c, "end_date", s))} · ${text(field(c, "goal", s))}`,
  },
  plan_breaks: {
    section: "Breaks",
    label: (c) => cap(text(field(c, "kind"))) || "Break",
    summary: (c, s) => `${span(field(c, "start_date", s), field(c, "end_date", s))}${field(c, "riding", s) ? ` · riding: ${text(field(c, "riding", s))}` : ""}`,
  },
  plan_days: {
    section: "Plan",
    label: (c) => day(field(c, "day")),
    summary: (c, s) => {
      const chosen = field(c, "chosen", s) as { session?: unknown } | null;
      return sessionText(chosen ? chosen.session : field(c, "planned", s));
    },
  },
  plan_weeks: {
    section: "Plan",
    label: (c) => `Week of ${day(field(c, "week"))}`,
    summary: (c, s) => {
      const days = field(c, "days", s);
      return Array.isArray(days) ? `${days.filter((d) => d && typeof d === "object" && (d as { session?: unknown }).session).length} rides` : "Week";
    },
  },
  event_courses: {
    section: "Events",
    label: (c) => text(field(c, "file_name")) || "Course",
    summary: () => "Course",
  },
  ftp_history: {
    section: "Profile",
    label: (c) => `FTP on ${day(field(c, "effective_date"))}`,
    summary: (c, s) => `${text(field(c, "watts", s))} W · ${text(field(c, "method", s))}`,
  },
  custom_workouts: {
    section: "Workouts",
    label: (c) => text(field(c, "name")),
    summary: (c, s) => text(field(c, "name", s)),
  },
  workout_favorites: {
    section: "Workouts",
    label: (c) => text(field(c, "workout_key")).replace(/^(library|custom):/, ""),
    summary: () => "Favorite",
  },
  layouts: {
    section: "Layout",
    label: (c) => `${text(field(c, "name"))} (${text(field(c, "device"))})`,
    summary: (c, s) => (field(c, "active", s) ? "In use" : "Saved"),
  },
  coach_memory: {
    section: "Coach memory",
    label: () => "Fact",
    summary: (c, s) => short(text(field(c, "fact", s))),
  },
  app_settings: {
    section: "Settings",
    label: (c) => text(field(c, "key")),
    summary: (c, s) => short(JSON.stringify(field(c, "value", s))),
  },
  plugins: {
    section: "Plugins",
    label: (c) => text(field(c, "name")),
    summary: (c, s) => `Version ${text(field(c, "version", s))}`,
  },
};

/** Rows shown field by field: label, how to show the value. */
const FIELDS: Record<string, { section: string; fields: Record<string, [string, (v: unknown) => string]> }> = {
  athlete_settings: {
    section: "Profile",
    fields: {
      ftp_watts: ["FTP", (v) => `${text(v)} W`],
      weight_kg: ["Weight", (v) => `${text(v)} kg`],
      max_hr: ["Max HR", (v) => `${text(v)} bpm`],
      threshold_hr: ["Threshold HR", (v) => `${text(v)} bpm`],
      height_cm: ["Height", (v) => `${text(v)} cm`],
      birth_date: ["Birthday", day],
      sex: ["Sex", text],
      timezone: ["Time zone", text],
      sleep_need_hours: ["Sleep need", (v) => `${text(v)} h`],
      availability: ["Riding time", weekly],
      ramp_rate: ["Ramp rate", (v) => `${text(v)} a week`],
    },
  },
  coach_persona: {
    section: "Coach",
    fields: {
      name: ["Name", text],
      tone: ["Tone", text],
      detail: ["Detail", text],
      instructions: ["Instructions", (v) => short(text(v)) || "None"],
    },
  },
  plugin_grants: {
    section: "Plugins",
    fields: {
      enabled: ["On", (v) => (v ? "On" : "Off")],
      coach_visible: ["Coach sees its numbers", (v) => (v ? "Yes" : "No")],
      read: ["Reads", (v) => (Array.isArray(v) && v.length ? v.join(", ") : "Nothing")],
      switched_off: ["Turned off by Lactic", (v) => text(v) || "No"],
    },
  },
};

/** What each changed row was and is now. */
export function describeChanges(changes: ChangedRow[]): ChangeLine[] {
  const lines: ChangeLine[] = [];
  for (const c of changes) {
    const byField = FIELDS[c.table];
    if (byField) {
      const prefix = c.table === "plugin_grants" ? `${text(field(c, "plugin_id"))}: ` : "";
      for (const [col, [label, show]] of Object.entries(byField.fields)) {
        const was = c.before ? read(c.table, col, c.before[col]) : null;
        const now = c.after ? read(c.table, col, c.after[col]) : null;
        if (JSON.stringify(was) === JSON.stringify(now)) continue;
        lines.push({ section: byField.section, label: prefix + label, was: c.before && was !== null ? show(was) : null, now: c.after && now !== null ? show(now) : null });
      }
      continue;
    }
    const s = SUMMARY[c.table];
    if (!s) {
      lines.push({ section: "Other", label: c.table, was: c.before ? "Before" : null, now: c.after ? "Changed" : null });
      continue;
    }
    const was = c.before ? s.summary(c, "before") : null;
    const now = c.after ? s.summary(c, "after") : null;
    // A plan day with no change of its own is the plan's session.
    if (c.table === "plan_days") lines.push({ section: s.section, label: s.label(c), was: was ?? "Plan's session", now: now ?? "Plan's session" });
    else lines.push({ section: s.section, label: s.label(c), was, now: was === now && c.before && c.after ? `${now} (edited)` : now });
  }
  return lines;
}

/** Most telling first, for the title. */
const ORDER = ["plugins", "training_goals", "training_plans", "plan_breaks", "plan_weeks", "athlete_settings", "ftp_history", "custom_workouts", "coach_persona", "coach_memory", "layouts", "plugin_grants", "workout_favorites", "event_courses", "plan_days", "app_settings"];

/** A title for an entry nobody named: what the most telling change did, and how many more. */
export function titleFor(changes: ChangedRow[]): string {
  if (!changes.length) return "No changes";
  const sorted = [...changes].sort((a, b) => rank(a.table) - rank(b.table));
  const lead = sorted[0];
  if (sorted.every((c) => c.table === "plan_days")) return changes.length === 1 ? `Changed the plan on ${day(field(lead, "day"))}` : `Changed the plan on ${changes.length} days`;
  const head = headline(lead);
  // Counted as the rider would: each field or row changed, less the lead's own (and a plugin's approval that came with it).
  const others = sorted.slice(1).filter((c) => !(lead.table === "plugins" && c.table === "plugin_grants"));
  const rest = Math.max(0, describeChanges([lead]).length - 1) + describeChanges(others).length;
  return rest > 0 ? `${head}, and ${rest} more ${rest === 1 ? "change" : "changes"}` : head;
}

const rank = (table: string) => {
  const i = ORDER.indexOf(table);
  return i < 0 ? ORDER.length : i;
};

function headline(c: ChangedRow): string {
  const lines = describeChanges([c]);
  const verb = !c.before ? "Added" : !c.after ? "Removed" : "Changed";
  if (c.table === "plugins") {
    if (c.before && c.after) return `Updated ${text(field(c, "name"))} to ${text(field(c, "version", "after"))}`;
    return `${verb} ${text(field(c, "name"))}`;
  }
  if (FIELDS[c.table]) {
    const l = lines[0];
    if (!l) return `Changed ${FIELDS[c.table].section.toLowerCase()}`;
    if (lines.length === 1 && l.was && l.now) return `${l.label} ${l.was} → ${l.now}`;
    return `Changed ${l.label}`;
  }
  const s = SUMMARY[c.table];
  if (!s) return `${verb} ${c.table}`;
  if (c.table === "training_goals" && c.before && c.after && field(c, "event_date", "before") !== field(c, "event_date", "after"))
    return `Moved ${s.label(c)} to ${day(field(c, "event_date", "after"))}`;
  if (c.table === "training_plans" && !c.before) return `Started plan “${s.label(c)}”`;
  if (c.table === "coach_memory") return `${verb} a Coach memory`;
  if (c.table === "workout_favorites") return `${!c.before ? "Favorited" : "Unfavorited"} ${s.label(c)}`;
  if (c.table === "plan_breaks") return `${verb} a break`;
  if (c.table === "plan_weeks") return `Re-planned the week of ${day(field(c, "week"))}`;
  return `${verb} ${s.label(c)}`;
}
