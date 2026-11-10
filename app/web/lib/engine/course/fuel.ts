// Fuel and kit for a course: carbohydrate, fluid and salt for the time it'll take and the heat it's
// forecast, when to eat (not halfway up a climb), and what to wear. Standard sports-nutrition
// guidance scaled to you; the same carbohydrate rule as the race-day card (raceday.ts).

import { carbsPerHour } from "../raceday";
import type { Goal } from "../plan";
import { STEP, type CourseProfile } from "./profile";
import type { Pacing } from "./pacing";
import type { RaceWeather } from "./weather";

export interface Feed {
  /** Seconds into the race. */
  seconds: number;
  km: number;
  grams: number;
  /** Why it's here rather than on the clock: before a climb, or over its top. */
  note?: string;
}

export interface FuelPlan {
  carbsPerHour: number | null;
  carbsTotal: number;
  fluidPerHour: number;
  fluidTotal: number;
  /** 750 ml bottles for the whole race. */
  bottles: number;
  sodiumPerHour: number;
  /** Whether fluid and salt come from the forecast (else a mild day is assumed). */
  fromForecast: boolean;
  feeds: Feed[];
  /** Carbohydrate the evening before and in the pre-race meal, grams; null without a weight. */
  carbLoad: { dayBefore: number; meal: number } | null;
}

/** Fluid an hour, ml, by how warm it feels: about 400 in the cold up to 1,000 in real heat. */
export function fluidPerHour(feels: number | null): number {
  if (feels === null) return 600;
  return feels <= 10 ? 400 : feels <= 18 ? 550 : feels <= 24 ? 700 : feels <= 30 ? 850 : 1000;
}

export function sodiumPerHour(feels: number | null): number {
  if (feels === null) return 400;
  return feels <= 18 ? 300 : feels <= 27 ? 500 : 800;
}

const kmAt = (k: number) => Math.round((k * STEP) / 100) / 10;

export function fuelPlan(goal: Goal, profile: CourseProfile, pacing: Pacing, weather: RaceWeather | null, weightKg: number | null): FuelPlan {
  const minutes = pacing.seconds / 60;
  const perHour = carbsPerHour({ ...goal, minutes });
  const hours = pacing.seconds / 3600;
  const feels = weather ? weather.feels[1] : null;
  const fluid = fluidPerHour(feels);
  const feeds: Feed[] = [];
  if (perHour) {
    const grams = Math.round(perHour / 3);
    const sampleAt = (seconds: number) => {
      const k = pacing.at.findIndex((t) => t >= seconds);
      return k < 0 ? pacing.at.length - 1 : k;
    };
    let last = 0;
    // Every 20 minutes, and never within 12 minutes of the last feed after one moves for a climb.
    for (let s = 20 * 60; s < pacing.seconds - 10 * 60; s = Math.max(s + 20 * 60, last + 12 * 60)) {
      let at = s;
      let note: string | undefined;
      const k = sampleAt(s);
      const climb = pacing.climbs.find((c) => k * STEP >= c.from && k * STEP < c.to && c.seconds >= 4 * 60);
      if (climb) {
        // Eat just before a climb when there's been time since the last feed; else over the top.
        if (climb.startsAt - 120 - last >= 8 * 60) {
          at = climb.startsAt - 120;
          note = `before climb ${climb.n}`;
        } else {
          at = climb.startsAt + climb.seconds + 60;
          note = `over the top of climb ${climb.n}`;
        }
      }
      if (at >= pacing.seconds - 10 * 60) break;
      last = at;
      feeds.push({ seconds: Math.round(at), km: kmAt(sampleAt(at)), grams, ...(note ? { note } : {}) });
    }
  }
  const fluidTotal = Math.round((fluid * hours) / 50) * 50;
  return {
    carbsPerHour: perHour,
    carbsTotal: perHour ? Math.round((perHour * hours) / 5) * 5 : 0,
    fluidPerHour: fluid,
    fluidTotal,
    bottles: Math.max(1, Math.ceil(fluidTotal / 750)),
    sodiumPerHour: sodiumPerHour(feels),
    fromForecast: weather !== null,
    feeds,
    // Over 90 minutes: 6 g/kg the day before (8 over 2.5 hours); 2 g/kg in the meal 3 hours out.
    carbLoad: weightKg ? { dayBefore: Math.round((weightKg * (minutes >= 150 ? 8 : minutes >= 90 ? 6 : 5)) / 10) * 10, meal: Math.round((weightKg * 2) / 10) * 10 } : null,
  };
}

/** What to wear and bring, from the forecast and the course. */
export function kitList(weather: RaceWeather | null, profile: CourseProfile, goal: Goal, fmt: { temp: (c: number) => string; wind: (kmh: number) => string } = { temp: (c) => `${c}°C`, wind: (k) => `${k} km/h` }): string[] {
  if (!weather) return [];
  const [cold, warm] = weather.feels;
  const out: string[] = [];
  if (cold < 5) out.push("Winter kit: thermal jacket, tights, full gloves and overshoes.");
  else if (cold < 10) out.push("A long-sleeve thermal jersey or light jacket, knee or leg warmers, full gloves.");
  else if (cold < 15) out.push("Arm and knee warmers and a gilet, all easy to pocket as it warms.");
  else if (cold < 19) out.push("Arm warmers or a gilet for the start.");
  else out.push("Summer kit.");
  if (warm >= 27) out.push(`It feels like ${fmt.temp(warm)} at its warmest: light colors, sun cream, and plan where to refill bottles.`);
  if (weather.rainChance >= 50 || weather.rainMm >= 1) out.push(`Rain is likely (${weather.rainChance}%): a packable rain jacket, clear lenses, and a little less tyre pressure.`);
  const descents = profile.climbs.some((c) => c.gain >= 300);
  if (descents && cold < 16 && warm - cold < 12) out.push("A gilet for the long descents: you'll cool fast off the top of a big climb.");
  if (weather.gusty && descents) out.push(`Gusts up to ${fmt.wind(weather.gustKmh)}: shallower rims, and take the descents with care.`);
  if (goal.kind === "gravel" || goal.kind === "mountainBike") if (weather.rainChance >= 50) out.push("Wet off-road: mud tyres if you have them, and lube the chain the night before.");
  return out;
}
