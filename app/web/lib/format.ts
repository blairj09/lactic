// Display helpers shared by pages.

import { isAllOut, segmentRange, type Interval } from "./engine/workout";

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}

export function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
}

export const SOURCE_LABEL: Record<string, string> = {
  app: "This app",
  strava: "Strava",
  zwift: "Zwift",
  zwift_fit: "Zwift file",
  karoo_fit: "Karoo file",
  fit: "FIT file",
  health: "Health",
  intervals: "intervals.icu",
};

/** Brand names as they're written, for sources the list above doesn't name. */
const BRANDS: Record<string, string> = {
  zwift: "Zwift",
  garmin: "Garmin",
  wahoo: "Wahoo",
  karoo: "Karoo",
  hammerhead: "Karoo",
  intervals: "intervals.icu",
  lactic: "Lactic",
  strava: "Strava",
  fit: "FIT",
  gpx: "GPX",
  tcx: "TCX",
  trainerroad: "TrainerRoad",
  rouvy: "Rouvy",
  mywhoosh: "MyWhoosh",
};

/** A ride's source as riders read it: "Zwift", "Garmin file", never "zwift" or "garmin_fit". */
export function sourceLabel(source: string): string {
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  const words = source.split(/[_\s-]+/).filter(Boolean);
  if (!words.length) return source;
  return words
    .map((w, i) => {
      const key = w.toLowerCase();
      if (key === "fit" && i > 0) return "file";
      if (BRANDS[key]) return BRANDS[key];
      return i === 0 ? key.charAt(0).toUpperCase() + key.slice(1) : key;
    })
    .join(" ");
}

/** A whole number with its sign, using a true minus: +4, −6, 0. */
export function signed(value: number): string {
  const r = Math.round(value);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0";
}

/** One decimal with its sign, using a true minus: +0.4, −1.2. */
export function signedFixed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;
}

/** Clock time: "4:05", or "1:02:30" past an hour. */
export function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** "275 W" for a steady interval, "150-210 W" for a ramp, "all out" for a sprint, "Free ride" otherwise. */
export function describeTarget(interval: Interval, ftp: number) {
  if (isAllOut(interval.segment)) return "all out";
  const range = segmentRange(interval.segment);
  if (!range) return "Free ride";
  const low = Math.round(range.low * ftp);
  const high = Math.round(range.high * ftp);
  return low === high ? `${low} W` : `${low}-${high} W`;
}

/** A ride's page on intervals.icu. */
export const intervalsUrl = (id: string) => `https://intervals.icu/activities/${encodeURIComponent(id)}`;
