// Race-day weather from Open-Meteo's free forecast (no account or key), at a few points along the
// course: what it'll be like while you race, and the wind on each stretch of road from its heading.
// Building the request and reading the answer are here; fetching is the caller's. No browser or Node APIs.

import { addDays } from "../pmc";
import { STEP, type CourseProfile } from "./profile";
import type { Pacing } from "./pacing";

/** Open-Meteo forecasts 16 days ahead; the last day is rough, so the report starts at 15. */
export const FORECAST_DAYS = 15;

export interface WeatherHour {
  /** Local time at the course, "YYYY-MM-DDTHH:MM". */
  time: string;
  temp: number;
  feels: number;
  /** Chance of rain, percent. */
  rainChance: number;
  rainMm: number;
  windKmh: number;
  /** Where the wind blows from, degrees from north. */
  windFrom: number;
  gustKmh: number;
  /** WMO weather code. */
  code: number;
}

export interface WeatherPoint {
  /** Kilometers into the course. */
  km: number;
  lat: number;
  lng: number;
  hours: WeatherHour[];
}

export interface Forecast {
  fetchedAt: string;
  /** The date it's for, YYYY-MM-DD. */
  date: string;
  points: WeatherPoint[];
  sunrise: string | null;
  sunset: string | null;
}

/** Where to ask for the weather: the start, then about every 30 km, at most five places. */
export function samplePoints(profile: CourseProfile): { km: number; lat: number; lng: number }[] {
  const n = profile.lat.length;
  const count = Math.min(5, Math.max(1, Math.round(profile.meters / 30000) + 1));
  const out: { km: number; lat: number; lng: number }[] = [];
  for (let i = 0; i < count; i++) {
    const k = count === 1 ? 0 : Math.round(((n - 1) * i) / (count - 1));
    out.push({ km: Math.round((k * STEP) / 100) / 10, lat: round(profile.lat[k], 4), lng: round(profile.lng[k], 4) });
  }
  return out;
}

const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

const HOURLY = ["temperature_2m", "apparent_temperature", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "weather_code"];

/** The forecast URL for a race on `date` (and the day after, for a late start or a long day). */
export function forecastUrl(points: { lat: number; lng: number }[], date: string): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lng).join(","),
    hourly: HOURLY.join(","),
    daily: "sunrise,sunset",
    wind_speed_unit: "kmh",
    timezone: "auto",
    start_date: date,
    end_date: addDays(date, 1),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** The elevation URL for up to 100 points (Open-Meteo's 90 m terrain model). */
export function elevationUrl(points: { lat: number; lng: number }[]): string {
  const q = new URLSearchParams({ latitude: points.map((p) => round(p.lat, 5)).join(","), longitude: points.map((p) => round(p.lng, 5)).join(",") });
  return `https://api.open-meteo.com/v1/elevation?${q}`;
}

type Hourly = Record<string, (number | string | null)[]>;

/** Reads Open-Meteo's answer (one object, or one per point) for the points asked about. */
export function parseForecast(json: unknown, points: { km: number; lat: number; lng: number }[], date: string, fetchedAt: string): Forecast {
  const list = (Array.isArray(json) ? json : [json]) as { hourly?: Hourly; daily?: Hourly; error?: boolean; reason?: string }[];
  if (list[0]?.error) throw new Error(`The forecast service said: ${list[0].reason ?? "no forecast"}`);
  const out: WeatherPoint[] = points.map((p, i) => {
    const h = list[i]?.hourly;
    if (!h || !Array.isArray(h.time)) throw new Error("The forecast came back without hourly weather");
    const num = (key: string, j: number) => {
      const v = h[key]?.[j];
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    };
    return {
      ...p,
      hours: h.time.map((time, j) => ({
        time: String(time),
        temp: num("temperature_2m", j),
        feels: num("apparent_temperature", j),
        rainChance: num("precipitation_probability", j),
        rainMm: num("precipitation", j),
        windKmh: num("wind_speed_10m", j),
        windFrom: num("wind_direction_10m", j),
        gustKmh: num("wind_gusts_10m", j),
        code: num("weather_code", j),
      })),
    };
  });
  const daily = list[0]?.daily;
  const day = daily?.time?.findIndex((t) => t === date) ?? -1;
  return {
    fetchedAt,
    date,
    points: out,
    sunrise: day >= 0 ? String(daily?.sunrise?.[day] ?? "") || null : null,
    sunset: day >= 0 ? String(daily?.sunset?.[day] ?? "") || null : null,
  };
}

/** The first day a forecast for `date` is worth fetching. */
export const forecastOpens = (date: string) => addDays(date, -FORECAST_DAYS);

/** Whether to fetch again: never before the window, then every 6 hours, every 2 in the last two days. */
export function forecastStale(forecast: Forecast | null, date: string, today: string, now: Date): boolean {
  if (today < forecastOpens(date) || today > date) return false;
  if (!forecast || forecast.date !== date) return true;
  const age = now.getTime() - Date.parse(forecast.fetchedAt);
  return age > (addDays(today, 2) >= date ? 2 : 6) * 3_600_000;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
/** Used when the event has no start time yet. */
export const DEFAULT_START = "09:00";

function hourAt(point: WeatherPoint, date: string, start: string, seconds: number): WeatherHour | null {
  const minutes = toMinutes(start) + seconds / 60;
  const day = addDays(date, Math.floor(minutes / 1440));
  const hour = Math.floor((minutes % 1440) / 60);
  const key = `${day}T${String(hour).padStart(2, "0")}`;
  return point.hours.find((h) => h.time.startsWith(key)) ?? null;
}

function nearest(forecast: Forecast, km: number): WeatherPoint {
  return forecast.points.reduce((best, p) => (Math.abs(p.km - km) < Math.abs(best.km - km) ? p : best), forecast.points[0]);
}

/** Wind at rider height is about 70% of the forecast's 10 m wind. */
const RIDER_HEIGHT = 0.7;

/** Wind against you at sample `k`, `seconds` into the race, m/s (negative is behind you). */
export function headwindAt(profile: CourseProfile, forecast: Forecast, start: string) {
  return (k: number, seconds: number): number => {
    const h = hourAt(nearest(forecast, (k * STEP) / 1000), forecast.date, start, seconds);
    if (!h) return 0;
    const diff = ((h.windFrom - profile.bearing[k]) * Math.PI) / 180;
    return (h.windKmh / 3.6) * RIDER_HEIGHT * Math.cos(diff);
  };
}

export interface WindStretch {
  fromKm: number;
  toKm: number;
  /** Average wind against you over it, km/h. */
  kmh: number;
}

export interface RaceWeather {
  /** The forecast hour by hour while you race, where you'll be at that hour. */
  hours: (WeatherHour & { km: number })[];
  temp: [number, number];
  feels: [number, number];
  rainChance: number;
  rainMm: number;
  windKmh: number;
  gustKmh: number;
  windFrom: number;
  condition: string;
  /** Shares of the course with a headwind, a tailwind, or a strong crosswind (over 8 km/h at rider height). */
  head: number;
  tail: number;
  cross: number;
  /** The longest stretch into the wind, 2 km or more. */
  worst: WindStretch | null;
  /** Gusts over 40 km/h, a concern on fast descents. */
  gusty: boolean;
  /** Start time used, and whether it's the default because the event has none. */
  start: string;
  assumedStart: boolean;
}

/** The race in the forecast: conditions over the hours you'll be racing, and the wind on the course. */
export function raceWeather(profile: CourseProfile, pacing: Pacing, forecast: Forecast, startTime: string | null | undefined): RaceWeather | null {
  const start = startTime || DEFAULT_START;
  const n = profile.ele.length;
  const hours: (WeatherHour & { km: number })[] = [];
  for (let s = 0; s <= pacing.seconds + 1800; s += 3600) {
    const k = Math.min(n - 1, pacing.at.findIndex((t) => t >= s) === -1 ? n - 1 : pacing.at.findIndex((t) => t >= s));
    const km = Math.round((k * STEP) / 100) / 10;
    const h = hourAt(nearest(forecast, km), forecast.date, start, s);
    if (h) hours.push({ ...h, km });
  }
  if (!hours.length) return null;
  const wind = headwindAt(profile, forecast, start);
  let head = 0;
  let tail = 0;
  let cross = 0;
  let worst: WindStretch | null = null;
  let runFrom = -1;
  let runSum = 0;
  const closeRun = (to: number) => {
    if (runFrom >= 0 && (to - runFrom) * STEP >= 2000) {
      const kmh = (runSum / (to - runFrom)) * 3.6;
      if (!worst || to - runFrom > (worst.toKm - worst.fromKm) * 10) worst = { fromKm: round((runFrom * STEP) / 1000, 1), toKm: round((to * STEP) / 1000, 1), kmh: Math.round(kmh) };
    }
    runFrom = -1;
    runSum = 0;
  };
  const strong = 8 / 3.6;
  for (let k = 0; k < n - 1; k++) {
    const w = wind(k, pacing.at[k]);
    const h = hourAt(nearest(forecast, (k * STEP) / 1000), forecast.date, start, pacing.at[k]);
    const total = h ? (h.windKmh / 3.6) * RIDER_HEIGHT : 0;
    const side = Math.sqrt(Math.max(0, total * total - w * w));
    if (w > strong) {
      head++;
      if (runFrom < 0) runFrom = k;
      runSum += w;
    } else {
      closeRun(k);
      if (w < -strong) tail++;
      else if (side > strong) cross++;
    }
  }
  closeRun(n - 1);
  const steps = Math.max(1, n - 1);
  const temps = hours.map((h) => h.temp);
  const feels = hours.map((h) => h.feels);
  const winds = hours.map((h) => h.windKmh);
  // The wind's direction, averaged as a vector so 350° and 10° make north.
  const x = hours.reduce((s, h) => s + h.windKmh * Math.sin((h.windFrom * Math.PI) / 180), 0);
  const y = hours.reduce((s, h) => s + h.windKmh * Math.cos((h.windFrom * Math.PI) / 180), 0);
  const gustKmh = Math.max(...hours.map((h) => h.gustKmh));
  return {
    hours,
    temp: [Math.round(Math.min(...temps)), Math.round(Math.max(...temps))],
    feels: [Math.round(Math.min(...feels)), Math.round(Math.max(...feels))],
    rainChance: Math.max(...hours.map((h) => h.rainChance)),
    rainMm: round(hours.reduce((s, h) => s + h.rainMm, 0), 1),
    windKmh: Math.round(winds.reduce((a, b) => a + b, 0) / winds.length),
    gustKmh: Math.round(gustKmh),
    windFrom: Math.round(((Math.atan2(x, y) * 180) / Math.PI + 360) % 360),
    condition: weatherLabel(worstCode(hours.map((h) => h.code))),
    head: round(head / steps, 2),
    tail: round(tail / steps, 2),
    cross: round(cross / steps, 2),
    worst,
    gusty: gustKmh >= 40,
    start,
    assumedStart: !startTime,
  };
}

/** The most notable weather over the hours: storms over rain over cloud. */
function worstCode(codes: number[]): number {
  const rank = (c: number) => (c >= 95 ? 6 : c >= 71 && c <= 86 && !(c >= 80 && c <= 82) ? 5 : c >= 61 || (c >= 80 && c <= 82) ? 4 : c >= 51 ? 3 : c >= 45 ? 2 : c >= 1 ? 1 : 0);
  return codes.reduce((best, c) => (rank(c) > rank(best) || (rank(c) === rank(best) && c > best) ? c : best), 0);
}

/** WMO weather codes in plain words. */
export function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Mixed";
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** "NW" for 315°. */
export const compass = (degrees: number) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
