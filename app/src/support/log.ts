// A short record of what the app did with gear and connected services: connects, drops, syncs and
// their errors, and what the coach tried or changed. The coach reads it to troubleshoot. It keeps
// the last few hundred events in this computer's browser storage, and strips anything that looks
// like a key or token before saving.

export type LogArea = "bluetooth" | "intervals" | "health" | "strava" | "coach" | "app";

export interface LogEvent {
  at: string;
  area: LogArea;
  level: "info" | "warn" | "error";
  message: string;
}

const STORAGE = "lactic.activityLog";
export const MAX_EVENTS = 300;
const MAX_MESSAGE = 300;

let events: LogEvent[] | null = null;

function load(): LogEvent[] {
  if (events) return events;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    events = Array.isArray(saved) ? saved : [];
  } catch {
    events = [];
  }
  return events;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(load()));
    } catch {}
  }, 500);
}

/** Takes out keys, tokens and passwords: long runs of letters and digits, auth headers, key=value pairs. */
export function scrub(text: string): string {
  return text
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9+/=._-]+/gi, "$1 •••")
    .replace(/\b(api[_-]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, "$1$2•••")
    .replace(/\bkeychain:[A-Za-z0-9._-]+/g, "keychain:•••")
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "•••");
}

/** Adds an event. Never throws. */
export function logEvent(area: LogArea, level: LogEvent["level"], message: string) {
  try {
    const list = load();
    list.push({ at: new Date().toISOString(), area, level, message: scrub(message).slice(0, MAX_MESSAGE) });
    if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS);
    save();
  } catch {}
}

/** Newest last; filtered by area when given. */
export function recentEvents({ area, limit = 40 }: { area?: LogArea; limit?: number } = {}): LogEvent[] {
  const list = load().filter((e) => !area || e.area === area);
  return list.slice(-limit);
}

/** For tests. */
export function clearLog() {
  events = [];
  try {
    localStorage.removeItem(STORAGE);
  } catch {}
}
