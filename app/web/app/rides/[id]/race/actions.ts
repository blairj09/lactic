"use server";

import { revalidatePath } from "next/cache";
import { raceDebrief } from "@/lib/coach/chat";
import { coachModel } from "@/lib/coach/conversation";
import { readResultsImage } from "@/lib/coach/race-results";
import { loadCoachData } from "@/lib/coach/store";
import { raceAdvice } from "@/lib/engine/race/advice";
import { raceForCoach } from "@/lib/engine/race/brief";
import { BEST_LAP_ID, raceReport } from "@/lib/engine/race/report";
import { parseResults } from "@/lib/engine/race/results";
import { addRival, fetchOwnTrack, loadRaceData, removeRival, saveDebrief, saveNotes, saveOwnName, saveOwnTrack, saveResults, trackFromFile } from "@/lib/race";
import { raceFormatters } from "@/lib/race-format";
import { createClient } from "@/lib/supabase/server";
import { readUnits } from "@/lib/units";
import type { ActionResult } from "../../../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function attempt(work: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await work();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const check = (id: string) => {
  if (!UUID.test(id)) throw new Error("Which ride?");
};
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** Your own ride file at full detail, from intervals.icu. */
export async function loadOwnTrack(activityId: string): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    const supabase = await createClient();
    const data = await loadRaceData(supabase, activityId);
    if (!data.intervalsId) throw new Error("This ride didn't come from intervals.icu: drop in your ride file instead");
    const track = await fetchOwnTrack(supabase, activityId, data.intervalsId);
    return `Got your ride file (${track.points.length} points)`;
  });
}

/** Your own ride file, dropped in (FIT or GPX). */
export async function uploadOwnTrack(activityId: string, fileName: string, base64: string): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    const track = trackFromFile(fileName, bytesOf(base64));
    if (!track.points.every((p) => p.t !== null)) throw new Error("Your own file needs times. Export the original file from your device or intervals.icu.");
    await saveOwnTrack(await createClient(), activityId, track);
    return "Saved your ride file";
  });
}

/** Another rider's GPX (Strava: ⋯ → Export GPX on their activity). */
export async function uploadRival(activityId: string, name: string, fileName: string, base64: string): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    const track = trackFromFile(fileName, bytesOf(base64));
    const who = name.trim() || track.name || fileName.replace(/\.(gpx|fit)$/i, "");
    await addRival(await createClient(), activityId, who.slice(0, 80), track);
    return `Added ${who}`;
  });
}

export async function deleteRival(id: string): Promise<ActionResult> {
  return attempt(async () => {
    check(id);
    await removeRival(await createClient(), id);
    return "Removed";
  });
}

export async function saveRaceResults(activityId: string, text: string, ownName: string | null): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    const rows = parseResults(text);
    if (text.trim() && !rows.length) throw new Error("Couldn't read any riders: one rider per line, with their place and times");
    await saveResults(await createClient(), activityId, text.trim().slice(0, 20_000), ownName);
    return rows.length ? `Read ${rows.length} riders` : "Cleared the results";
  });
}

export async function setOwnRow(activityId: string, ownName: string | null): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    await saveOwnName(await createClient(), activityId, ownName);
    return "Saved";
  });
}

/** Results off a screenshot, read by the vision model into text for the results box. */
export async function readResultsScreenshot(dataUrl: string): Promise<ActionResult & { text?: string }> {
  try {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(dataUrl)) throw new Error("That isn't an image");
    const text = await readResultsImage(dataUrl);
    const rows = parseResults(text);
    if (!rows.length) throw new Error("Couldn't read any results from that image");
    return { ok: true, message: `Read ${rows.length} riders. Check them, then save.`, text };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveRaceNotes(activityId: string, notes: string): Promise<ActionResult> {
  return attempt(async () => {
    check(activityId);
    await saveNotes(await createClient(), activityId, notes);
    return "Saved";
  });
}

/** The coach's written debrief, from the engine's report against one rider (or your best lap). */
export async function writeRaceDebrief(activityId: string, compareId: string): Promise<ActionResult & { text?: string }> {
  try {
    check(activityId);
    const coach = coachModel();
    if (!coach) throw new Error("Set up the built-in coach in Settings → Coach to get a written debrief");
    const supabase = await createClient();
    const data = await loadRaceData(supabase, activityId);
    if (!data.ownTrack) throw new Error("Add your ride file first");
    const report = raceReport({ own: data.ownTrack, ownName: data.ownName, rivals: data.rivals, results: data.results });
    const c = report.comparisons.find((x) => x.id === compareId) ?? report.comparisons.find((x) => x.id !== BEST_LAP_ID) ?? report.comparisons[0];
    const advice = raceAdvice(report, c, raceFormatters(readUnits()));
    const { data: feedback } = await supabase.from("ride_feedback").select("difficulty, rpe, note").eq("activity_id", activityId).maybeSingle();
    const notes = [data.notes, feedback ? `After the ride: ${feedback.difficulty}${feedback.rpe ? `, RPE ${feedback.rpe}/10` : ""}${feedback.note ? `. "${feedback.note}"` : ""}` : ""].filter(Boolean).join("\n");
    const coachData = await loadCoachData(supabase);
    const reply = await raceDebrief(coach.complete, coachData, raceForCoach(report, c, advice), notes);
    await saveDebrief(supabase, activityId, reply.message, c.name);
    revalidatePath("/", "layout");
    return { ok: true, message: "Written", text: reply.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
