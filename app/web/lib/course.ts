// An event's course, stored: the file the rider attached, its profile summary for the plan, and the
// race-day forecast, fetched from Open-Meteo (free, no account) once the race is about two weeks out.
// The numbers all come from the engine (engine/course).

import { decodeFit } from "./fit/decode";
import { courseProfile, distances, elevationSamples, fillElevation, summarize, thinTrack, type CourseSummary } from "./engine/course/profile";
import { bikeRegSearchUrl, findCourseLinks, parseBikeRegSearch, rwgpsTrack, type CourseLink, type EventHit } from "./engine/course/events";
import { elevationUrl, forecastStale, forecastUrl, parseForecast, samplePoints, type Forecast } from "./engine/course/weather";
import { PACKS, type Pack } from "./engine/course/pacing";
import { packTrack, parseGpx, parseTcx, trackFromRecords, unpackTrack, type PackedTrack, type Track } from "./engine/race/track";
import type { createClient } from "./supabase/server";
import { getSetting, setSetting } from "~/settings/store";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface StoredCourse {
  id: string;
  goalId: string;
  fileName: string | null;
  track: Track;
  summary: CourseSummary;
  elevationSource: "file" | "terrain" | null;
  forecast: Forecast | null;
  /** A finish time the rider is aiming for, seconds. */
  targetSeconds: number | null;
  /** How it's ridden, when the rider said. */
  pack: Pack | null;
}

const packFrom = (v: unknown): Pack | null => (PACKS.includes(v as Pack) ? (v as Pack) : null);
const secondsFrom = (v: unknown): number | null => (typeof v === "number" && v > 0 ? v : null);

export interface CourseBrief {
  summary: CourseSummary;
  targetSeconds: number | null;
  pack: Pack | null;
}

/** A course file (GPX, TCX or FIT) as a track. Times, power and heart rate don't matter for a course. */
export function courseFromFile(fileName: string, bytes: Uint8Array): Track {
  const isFit = bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT";
  if (isFit) return trackFromRecords(fileName.replace(/\.fit$/i, "") || null, decodeFit(bytes).records);
  const text = new TextDecoder().decode(bytes);
  if (/<gpx[\s>]/i.test(text)) return parseGpx(text);
  if (/<TrainingCenterDatabase[\s>]/i.test(text)) return parseTcx(text);
  throw new Error("That isn't a GPX, TCX or FIT file");
}

/** Summaries of every event's course, with its target time and pack, by event id, for the plan. Empty when there are none (or the table isn't there yet). */
export async function loadCourseSummaries(supabase: Supabase): Promise<Map<string, CourseBrief>> {
  const { data, error } = await supabase.from("event_courses").select("goal_id, summary, target_seconds, pack");
  if (error) {
    console.error(error);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.goal_id as string, { summary: r.summary as CourseSummary, targetSeconds: secondsFrom(r.target_seconds), pack: packFrom(r.pack) }]));
}

/** An event's course track alone, for working out what a target time takes. */
export async function loadCourseTrack(supabase: Supabase, goalId: string): Promise<Track | null> {
  const { data, error } = await supabase.from("event_courses").select("track").eq("goal_id", goalId).maybeSingle();
  if (error || !data) return null;
  return unpackTrack(data.track as PackedTrack);
}

/** Sets an event's target finish time and how it's ridden (null clears either). */
export async function saveCourseTarget(supabase: Supabase, goalId: string, targetSeconds: number | null, pack: Pack | null) {
  const { data, error } = await supabase.from("event_courses").update({ target_seconds: targetSeconds, pack, updated_at: new Date().toISOString() }).eq("goal_id", goalId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Add the event's course first: a target time needs the course to work out.");
}

export async function loadCourse(supabase: Supabase, goalId: string): Promise<StoredCourse | null> {
  const { data, error } = await supabase.from("event_courses").select("*").eq("goal_id", goalId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id as string,
    goalId,
    fileName: (data.file_name as string | null) ?? null,
    track: unpackTrack(data.track as PackedTrack),
    summary: data.summary as CourseSummary,
    elevationSource: (data.elevation_source as StoredCourse["elevationSource"]) ?? null,
    forecast: (data.forecast as Forecast | null) ?? null,
    targetSeconds: secondsFrom(data.target_seconds),
    pack: packFrom(data.pack),
  };
}

const TIMEOUT_MS = 15_000;

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`The weather service answered ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Heights for a track that has none, from Open-Meteo's terrain model, 100 points a request. */
async function lookUpElevation(track: Track): Promise<Track> {
  const d = distances(track);
  // Every 100 m, or fewer for a long course: at most 15 requests.
  const spacing = Math.max(100, Math.round(d[d.length - 1] / 1500));
  const samples = elevationSamples(track, spacing);
  const out: { index: number; ele: number }[] = [];
  for (let i = 0; i < samples.length; i += 100) {
    const chunk = samples.slice(i, i + 100);
    const json = (await getJson(elevationUrl(chunk))) as { elevation?: number[] };
    if (!Array.isArray(json.elevation) || json.elevation.length !== chunk.length) throw new Error("The terrain lookup came back incomplete");
    chunk.forEach((s, j) => out.push({ index: s.index, ele: json.elevation![j] }));
  }
  return fillElevation(track, out);
}

/**
 * Saves a course for an event, replacing any it had. A file with no heights gets them from the
 * terrain model when that can be reached; otherwise it's kept flat and the report says so.
 */
export async function saveCourse(supabase: Supabase, goalId: string, fileName: string, track: Track): Promise<{ summary: CourseSummary; elevationSource: "file" | "terrain" | null }> {
  let thin = thinTrack(track);
  let profile = courseProfile(thin);
  let elevationSource: "file" | "terrain" | null = profile.hasElevation ? "file" : null;
  if (!profile.hasElevation) {
    try {
      thin = await lookUpElevation(thin);
      profile = courseProfile(thin);
      elevationSource = "terrain";
    } catch (e) {
      console.error(e);
    }
  }
  const summary = summarize(profile);
  const { error } = await supabase.from("event_courses").upsert(
    { goal_id: goalId, file_name: fileName.slice(0, 200), track: packTrack(thin), summary, elevation_source: elevationSource, forecast: null, forecast_at: null, updated_at: new Date().toISOString() },
    { onConflict: "goal_id" },
  );
  if (error) throw error;
  return { summary, elevationSource };
}

export async function removeCourse(supabase: Supabase, goalId: string) {
  const { error } = await supabase.from("event_courses").delete().eq("goal_id", goalId);
  if (error) throw error;
}

/**
 * The race-day forecast, fetched when it's due (from 15 days out, every few hours) and kept. Returns
 * what's stored when it isn't due or the service can't be reached, with the error, if any.
 */
export async function refreshForecast(supabase: Supabase, course: StoredCourse, date: string, today: string, force = false): Promise<{ forecast: Forecast | null; error: string | null }> {
  if (!force && !forecastStale(course.forecast, date, today, new Date())) return { forecast: course.forecast, error: null };
  if (force && today > date) return { forecast: course.forecast, error: null };
  try {
    const points = samplePoints(courseProfile(course.track));
    const fetchedAt = new Date().toISOString();
    const forecast = parseForecast(await getJson(forecastUrl(points, date)), points, date, fetchedAt);
    const { error } = await supabase.from("event_courses").update({ forecast, forecast_at: fetchedAt, updated_at: fetchedAt }).eq("goal_id", course.goalId);
    if (error) throw error;
    return { forecast, error: null };
  } catch (e) {
    return { forecast: course.forecast, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Finding the race and its course ─────────────────────────────────────────────────────────

async function get(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
    // Read it all before the timer goes.
    const body = await response.arrayBuffer();
    return new Response(body, { status: response.status, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
}

/** Upcoming events named like `text`, from BikeReg (US races and rides): this year's and next. */
export async function searchEvents(text: string, today: string): Promise<EventHit[]> {
  const year = Number(today.slice(0, 4));
  const pages = await Promise.all([year, year + 1].map(async (y) => parseBikeRegSearch(await (await get(bikeRegSearchUrl(text, y))).json(), today)));
  const seen = new Set<number>();
  return pages.flat().filter((e) => !seen.has(e.id) && (seen.add(e.id), true)).slice(0, 20);
}

/** Course links for an event: from its description, else from its own website's front page. */
export async function findEventCourse(event: Pick<EventHit, "notes" | "website">): Promise<CourseLink[]> {
  const fromNotes = findCourseLinks(event.notes);
  if (fromNotes.some((l) => l.kind !== "strava") || !event.website) return fromNotes;
  try {
    const html = await (await get(event.website)).text();
    const fromSite = findCourseLinks(html, event.website);
    return [...fromNotes, ...fromSite.filter((l) => !fromNotes.some((n) => n.url === l.url))];
  } catch (e) {
    console.error(e);
    return fromNotes;
  }
}

/** A course from a link: a Ride with GPS route or ride, or a GPX, TCX or FIT file on the web. */
export async function courseFromUrl(url: string): Promise<{ name: string; track: Track }> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error("That doesn't look like a link");
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("That doesn't look like a link");
  const rw = parsed.href.match(/ridewithgps\.com\/(routes|trips)\/(\d+)/i);
  if (rw) {
    const page = `https://ridewithgps.com/${rw[1].toLowerCase()}/${rw[2]}`;
    try {
      const track = rwgpsTrack(await (await get(`${page}.json`)).json());
      return { name: track.name ?? `Ride with GPS ${rw[2]}`, track };
    } catch {
      // Older or locked-down routes: the GPX export, which public routes allow.
      const bytes = new Uint8Array(await (await get(`${page}.gpx?sub_format=track`)).arrayBuffer());
      return { name: `ridewithgps-${rw[2]}.gpx`, track: courseFromFile("course.gpx", bytes) };
    }
  }
  if (/strava\.com$/i.test(parsed.hostname)) throw new Error("Strava routes need a Strava sign-in to download. On the route's page, choose Export GPX and attach the file instead.");
  const bytes = new Uint8Array(await (await get(parsed.href)).arrayBuffer());
  const name = decodeURIComponent(parsed.pathname.split("/").pop() || "course");
  return { name, track: courseFromFile(name, bytes) };
}

const HOME_ELEVATION = "home_elevation";

/** Where the rider lives and trains, meters above sea level, when they've said. */
export async function loadHomeElevation(): Promise<number | null> {
  const v = await getSetting<unknown>(HOME_ELEVATION, null).catch(() => null);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function saveHomeElevation(meters: number) {
  await setSetting(HOME_ELEVATION, Math.round(meters));
}
