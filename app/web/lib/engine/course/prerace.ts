// The pre-race report: everything about an event's course in one place, built from its course file,
// the rider's FTP and weight, and (from about two weeks out) the forecast. Every number comes from
// here, so the report, the coach and the plan agree.

import { goalMinutes, type Goal } from "../plan";
import { fuelPlan, kitList, type FuelPlan } from "./fuel";
import { packOf, paceCourse, type Pack, type Pacing, type Rider } from "./pacing";
import { droppedTime, targetPlan, type DroppedTime, type TargetPlan } from "./target";
import { STEP, rises, type CourseProfile } from "./profile";
import { courseDemands, courseShape, type CourseShape } from "./shape";
import { compass, forecastOpens, headwindAt, raceWeather, type Forecast, type RaceWeather } from "./weather";

export interface Descent {
  from: number;
  to: number;
  drop: number;
  grade: number;
}

export type ForecastState = "early" | "ready" | "missing" | "past";

export interface PreRaceReport {
  profile: CourseProfile;
  pacing: Pacing;
  descents: Descent[];
  weather: RaceWeather | null;
  forecastState: ForecastState;
  /** The day the forecast starts, YYYY-MM-DD. */
  forecastOpens: string;
  fuel: FuelPlan;
  kit: string[];
  tips: string[];
  shape: CourseShape | null;
  /** The event's own duration and the course's estimate, minutes, when they're far apart (over 15%). */
  durationGap: { event: number; estimate: number } | null;
  daysToGo: number;
  /** How it's ridden, for the draft. */
  pack: Pack;
  /** The finish time the rider set, what it takes and whether it's in reach. */
  target: TargetPlan | null;
  /** For a group event: the time if dropped on the main climb. */
  dropped: DroppedTime | null;
}

const km = (meters: number) => Math.round(meters / 100) / 10;
const mins = (seconds: number) => Math.max(1, Math.round(seconds / 60));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function findDescents(p: CourseProfile): Descent[] {
  if (!p.hasElevation) return [];
  const neg = p.ele.map((e) => -e);
  return rises(neg, 150, 0.03).map(([a, b]) => ({ from: a * STEP, to: b * STEP, drop: Math.round(p.ele[a] - p.ele[b]), grade: Math.round(((p.ele[a] - p.ele[b]) / ((b - a) * STEP)) * 1000) / 1000 }));
}

/** Distances, heights, speeds and temperatures in the rider's units. */
export interface CourseFormatters {
  /** "km 23.4" or "mile 14.5". */
  at: (meters: number) => string;
  /** "8.4 km" or "5.2 mi". */
  distance: (meters: number) => string;
  /** "512 m" or "1680 ft". */
  height: (meters: number) => string;
  /** "15 km/h" or "9 mph", from km/h. */
  wind: (kmh: number) => string;
  /** "28°C" or "82°F". */
  temp: (celsius: number) => string;
}

export const METRIC: CourseFormatters = {
  at: (m) => `km ${km(m)}`,
  distance: (m) => `${km(m)} km`,
  height: (m) => `${Math.round(m)} m`,
  wind: (kmh) => `${Math.round(kmh)} km/h`,
  temp: (c) => `${Math.round(c)}°C`,
};

export interface PreRaceInput {
  goal: Goal;
  profile: CourseProfile;
  rider: Rider;
  forecast: Forecast | null;
  today: string;
  fmt?: CourseFormatters;
  /** A finish time to aim for, seconds. */
  targetSeconds?: number | null;
}

export function preRaceReport({ goal, profile, rider, forecast, today, fmt = METRIC, targetSeconds = null }: PreRaceInput): PreRaceReport {
  const opens = forecastOpens(goal.date);
  const usable = forecast && forecast.date === goal.date && forecast.points.length ? forecast : null;
  const state: ForecastState = today > goal.date ? "past" : today < opens ? "early" : usable ? "ready" : "missing";
  const start = goal.startTime || null;
  // Pace once without wind to know when you'll be where, then again with the wind on each stretch.
  let pacing = paceCourse(profile, goal, rider);
  let weather: RaceWeather | null = null;
  let headwind: ReturnType<typeof headwindAt> | undefined;
  if (usable && state === "ready") {
    weather = raceWeather(profile, pacing, usable, start);
    if (weather) {
      headwind = headwindAt(profile, usable, weather.start);
      pacing = paceCourse(profile, goal, rider, headwind);
      weather = raceWeather(profile, pacing, usable, start);
    }
  }
  const target = targetSeconds && targetSeconds > 0 ? targetPlan(profile, goal, rider, targetSeconds, today, { headwind }) : null;
  const dropped = droppedTime(profile, goal, rider, pacing, { headwind });
  const descents = findDescents(profile);
  const fuel = fuelPlan(goal, profile, pacing, weather, rider.weightKg);
  const summary = { meters: profile.meters, gain: profile.gain, loss: profile.loss, type: profile.type, loop: profile.loop, hasElevation: profile.hasElevation, climbs: profile.climbs };
  const shape = courseShape({ ...goal, course: courseDemands(summary, goal.kind, goal, rider) });
  const estimate = mins(pacing.seconds);
  const event = goalMinutes(goal);
  return {
    profile,
    pacing,
    descents,
    weather,
    forecastState: state,
    forecastOpens: opens,
    fuel,
    kit: kitList(weather, profile, goal, fmt),
    tips: tips(goal, profile, pacing, descents, weather, fmt, dropped),
    shape,
    durationGap: Math.abs(estimate - event) / event > 0.15 ? { event, estimate } : null,
    daysToGo: daysBetween(today, goal.date),
    pack: packOf(goal),
    target,
    dropped,
  };
}

const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
const watts = ([lo, hi]: [number, number]) => `${lo}-${hi} W`;

/** Pacing advice in plain words, from the course, the pacing and the wind. */
function tips(goal: Goal, p: CourseProfile, pacing: Pacing, descents: Descent[], weather: RaceWeather | null, fmt: CourseFormatters, dropped: DroppedTime | null): string[] {
  const out: string[] = [];
  if (pacing.pack === "bunch") {
    out.push(
      goal.kind === "criterium"
        ? "In a crit the power is in the corners and the moves, not the average: stay in the top third, sit in on the straights and save matches for the finish."
        : "In the bunch the flats cost far less than the numbers here suggest: sit in, stay near the front third, and save efforts for the climbs and the moves that matter.",
    );
  } else if (pacing.pack === "group") out.push("In a group, take short, steady turns on the front and sit in the rest: the draft saves about a quarter of your effort at speed.");
  if (dropped && dropped.cost >= 120) {
    out.push(`Staying with the group over climb ${dropped.climb} is worth about ${mins(dropped.cost)} min: dropped there, you ride the rest alone. Go into it near the front so you can slide back and still crest with them.`);
  }
  const climbs = pacing.climbs.filter((c) => c.seconds >= 120);
  const biggest = [...climbs].sort((a, b) => b.seconds * b.grade - a.seconds * a.grade)[0];
  if (!p.hasElevation) out.push("The course file has no heights, so the profile is flat and the times assume it. Export it with elevation for climbs and pacing.");
  if (biggest) {
    out.push(
      `Climb ${biggest.n} (${fmt.at(biggest.from)}, ${fmt.distance(biggest.to - biggest.from)} at ${(biggest.grade * 100).toFixed(1)}%) is the big one: about ${mins(biggest.seconds)} min. Hold ${watts(biggest.watts)}; the first two minutes are where it's easy to go too hard.`,
    );
  }
  const late = climbs.filter((c) => c.from >= p.meters * 0.7);
  const lastLate = late[late.length - 1];
  if (lastLate && climbs.length > 1) out.push(`Climb ${lastLate.n} comes late, at ${fmt.at(lastLate.from)}. Ride the earlier climbs at the bottom of their ranges so there's something left here.`);
  const finish = Math.max(0, p.ele.length - 1 - Math.round(3000 / STEP));
  const finishGrade = p.ele.length > 1 ? (p.ele[p.ele.length - 1] - p.ele[finish]) / ((p.ele.length - 1 - finish) * STEP) : 0;
  if (finishGrade >= 0.03) out.push(`The last ${fmt.distance(3000)} climb at ${(finishGrade * 100).toFixed(1)}%: an uphill finish, so position yourself before it starts.`);
  const longDescent = [...descents].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
  if (longDescent && longDescent.to - longDescent.from >= 3000) {
    out.push(`From ${fmt.at(longDescent.from)} it's ${fmt.distance(longDescent.to - longDescent.from)} downhill (${fmt.height(longDescent.drop)}). Eat and drink at the top, then soft-pedal around ${pacing.descentWatts} W.`);
  }
  if (!climbs.length && p.hasElevation) {
    out.push(
      goal.kind === "timeTrial"
        ? `No real climbs: hold ${watts(pacing.flatWatts)} the whole way, a little over on rises and into the wind.`
        : "No real climbs: the race is about position, the wind and the finish. Save efforts for the moves that matter.",
    );
  }
  if (weather?.worst && weather.worst.kmh >= 10) {
    out.push(`${cap(fmt.at(weather.worst.fromKm * 1000))} to ${fmt.at(weather.worst.toKm * 1000).replace(/^\D+ /, "")} is into a headwind of about ${fmt.wind(weather.worst.kmh)} (wind from the ${compass(weather.windFrom)}). Tuck in or share the work; it'll be slower than it feels.`);
  }
  if (weather && weather.tail >= 0.3) out.push(`About ${Math.round(weather.tail * 100)}% of the course has the wind behind you: those stretches go fast, so don't chase speed into the wind.`);
  if (weather && weather.feels[1] >= 28) out.push(`It may feel like ${fmt.temp(weather.feels[1])}: heat costs power, so take about 5% off these targets if it's that hot, and drink to the plan.`);
  return out;
}
