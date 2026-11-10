// An event's course, stored: the file the rider attached, its profile summary for the plan, and the
// race-day forecast, fetched from Open-Meteo (free, no account) once the race is about two weeks out.
// The numbers all come from the engine (engine/course).

import { decodeFit } from "./fit/decode";
import { courseProfile, distances, elevationSamples, fillElevation, summarize, thinTrack, type CourseSummary } from "./engine/course/profile";
import { elevationUrl, forecastStale, forecastUrl, parseForecast, samplePoints, type Forecast } from "./engine/course/weather";
import { packTrack, parseGpx, parseTcx, trackFromRecords, unpackTrack, type PackedTrack, type Track } from "./engine/race/track";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface StoredCourse {
  id: string;
  goalId: string;
  fileName: string | null;
  track: Track;
  summary: CourseSummary;
  elevationSource: "file" | "terrain" | null;
  forecast: Forecast | null;
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

/** Summaries of every event's course, by event id, for the plan. Empty when there are none (or the table isn't there yet). */
export async function loadCourseSummaries(supabase: Supabase): Promise<Map<string, CourseSummary>> {
  const { data, error } = await supabase.from("event_courses").select("goal_id, summary");
  if (error) {
    console.error(error);
    return new Map();
  }
  return new Map((data ?? []).map((r) => [r.goal_id as string, r.summary as CourseSummary]));
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
