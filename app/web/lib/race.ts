// A race's review, stored: the rider's own full-detail track, other riders' GPX tracks, the
// official results and the coach's debrief. The numbers all come from the engine (engine/race).

import { copyIntervalsId, loadRide } from "./activities";
import { decodeFit } from "./fit/decode";
import { downloadOriginal, loadConnection } from "./intervals/client";
import { mergeCurves, type PowerCurve } from "./engine/power";
import { parseResults, type ResultRow } from "./engine/race/results";
import { parsePlaces, type Place } from "./engine/race/solo";
import { packTrack, parseGpx, trackFromRecords, unpackTrack, type PackedTrack, type Track } from "./engine/race/track";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface RaceRival {
  id: string;
  name: string;
  track: Track;
  /** One of the rider's own earlier rides of the course (a past edition), not another rider. */
  past: boolean;
}

export interface RaceData {
  activityId: string;
  ownTrack: Track | null;
  ownName: string | null;
  resultsText: string;
  results: ResultRow[];
  /** What the rider wrote about the race. */
  notes: string;
  rivals: RaceRival[];
  /** Named places on a race that isn't laps (feed zones, summits), as typed and as read. */
  placesText: string;
  places: Place[];
  debrief: { text: string; rival: string | null; at: string } | null;
  /** Where the rider's own file could come from when it isn't stored yet. */
  intervalsId: string | null;
}

export async function loadRaceData(supabase: Supabase, activityId: string): Promise<RaceData> {
  const [{ data: review, error }, { data: rivals, error: rivalsError }, ride, copy] = await Promise.all([
    supabase.from("race_reviews").select("*").eq("activity_id", activityId).maybeSingle(),
    supabase.from("race_rivals").select("id, name, track, kind, created_at").eq("activity_id", activityId).order("created_at"),
    loadRide(supabase, activityId),
    copyIntervalsId(supabase, activityId),
  ]);
  if (error) throw error;
  if (rivalsError) throw rivalsError;
  const resultsText = (review?.results_text as string | null) ?? "";
  const placesText = (review?.places_text as string | null) ?? "";
  return {
    activityId,
    ownTrack: review?.own_track ? unpackTrack(review.own_track as PackedTrack) : null,
    ownName: (review?.own_name as string | null) ?? null,
    resultsText,
    results: resultsText ? parseResults(resultsText) : [],
    notes: (review?.notes as string | null) ?? "",
    rivals: (rivals ?? []).map((r) => ({ id: r.id as string, name: r.name as string, track: unpackTrack(r.track as PackedTrack), past: r.kind === "past" })),
    placesText,
    places: parsePlaces(placesText),
    debrief: review?.debrief ? { text: review.debrief as string, rival: (review.debrief_rival as string | null) ?? null, at: review.debrief_at as string } : null,
    intervalsId: ride?.intervalsId ?? copy ?? null,
  };
}

async function saveReview(supabase: Supabase, activityId: string, fields: Record<string, unknown>) {
  const { error } = await supabase
    .from("race_reviews")
    .upsert({ activity_id: activityId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
  if (error) throw error;
}

/** A ride file (FIT or GPX) as a track. */
export function trackFromFile(fileName: string, bytes: Uint8Array): Track {
  const isFit = bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT";
  if (isFit) {
    const fit = decodeFit(bytes);
    return trackFromRecords(fileName.replace(/\.fit$/i, "") || null, fit.records);
  }
  const text = new TextDecoder().decode(bytes);
  if (/<gpx[\s>]/i.test(text)) return parseGpx(text);
  throw new Error("That isn't a GPX or FIT file");
}

export async function saveOwnTrack(supabase: Supabase, activityId: string, track: Track) {
  await saveReview(supabase, activityId, { own_track: packTrack(track) });
}

/** Fetches the rider's own ride file from intervals.icu, where their rides come from, and keeps its track. */
export async function fetchOwnTrack(supabase: Supabase, activityId: string, intervalsId: string): Promise<Track> {
  const connection = await loadConnection(supabase);
  if (!connection) throw new Error("Connect intervals.icu, or drop in your own ride file");
  const bytes = await downloadOriginal(connection.apiKey, intervalsId);
  if (!bytes) throw new Error("intervals.icu doesn't have this ride's original file");
  const track = trackFromFile("ride", bytes);
  await saveOwnTrack(supabase, activityId, track);
  return track;
}

export async function addRival(supabase: Supabase, activityId: string, name: string, track: Track, past = false) {
  const { error } = await supabase.from("race_rivals").insert({ activity_id: activityId, name, track: packTrack(track), kind: past ? "past" : null });
  if (error) throw error;
}

export async function removeRival(supabase: Supabase, id: string) {
  const { error } = await supabase.from("race_rivals").delete().eq("id", id);
  if (error) throw error;
}

export async function saveResults(supabase: Supabase, activityId: string, text: string, ownName: string | null) {
  await saveReview(supabase, activityId, { results_text: text, own_name: ownName });
}

export async function saveOwnName(supabase: Supabase, activityId: string, ownName: string | null) {
  await saveReview(supabase, activityId, { own_name: ownName });
}

export async function saveDebrief(supabase: Supabase, activityId: string, text: string, rival: string | null) {
  await saveReview(supabase, activityId, { debrief: text, debrief_rival: rival, debrief_at: new Date().toISOString() });
}

export async function saveNotes(supabase: Supabase, activityId: string, notes: string) {
  await saveReview(supabase, activityId, { notes: notes.trim().slice(0, 4000) });
}

export async function savePlaces(supabase: Supabase, activityId: string, text: string) {
  await saveReview(supabase, activityId, { places_text: text.trim().slice(0, 4000) });
}

/** Your best power in the 90 days before a race: the fresh mark a solo report reads durability against. */
export async function bestCurveBefore(supabase: Supabase, startedAt: string): Promise<PowerCurve | null> {
  const end = new Date(startedAt);
  const start = new Date(end.getTime() - 90 * 86_400_000);
  const { data, error } = await supabase
    .from("activities")
    .select("power_curve")
    .gte("started_at", start.toISOString())
    .lt("started_at", end.toISOString())
    .is("duplicate_of", null)
    .not("power_curve", "is", null);
  if (error) throw error;
  const curves = (data ?? []).map((r) => r.power_curve as PowerCurve).filter(Boolean);
  return curves.length ? mergeCurves(...curves) : null;
}
