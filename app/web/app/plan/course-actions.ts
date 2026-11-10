"use server";

import { revalidatePath } from "next/cache";
import { courseFromFile, courseFromUrl, findEventCourse, loadCourse, refreshForecast, removeCourse, saveCourse, saveCourseTarget, saveHomeElevation, searchEvents } from "@/lib/course";
import { PACK_LABELS, PACKS, type Pack } from "@/lib/engine/course/pacing";
import { clock, parseFinishTime } from "@/lib/engine/course/target";
import type { CourseLink, EventHit } from "@/lib/engine/course/events";
import { COURSE_TYPE_LABELS, type CourseSummary } from "@/lib/engine/course/profile";
import { localDate } from "@/lib/engine/activity";
import { loadAthlete } from "@/lib/activities";
import { loadGoals } from "@/lib/training";
import { createClient } from "@/lib/supabase/server";
import { measureRiderDrag } from "@/lib/calibration";
import type { ActionResult } from "../actions";

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
  if (!UUID.test(id)) throw new Error("Which event?");
};
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** What a saved course came to, in a sentence. */
export async function courseSaved({ summary, elevationSource }: { summary: CourseSummary; elevationSource: "file" | "terrain" | null }): Promise<string> {
  const km = (summary.meters / 1000).toFixed(1);
  const heights = elevationSource === "terrain" ? " (heights looked up, the file had none)" : elevationSource === null ? " (no heights in the file, so it's treated as flat)" : "";
  return `Course saved: ${km} km, ${summary.gain} m of climbing, ${COURSE_TYPE_LABELS[summary.type].toLowerCase()}${heights}.`;
}

/** Attaches a course file (GPX, TCX or FIT) to an event, replacing any it had. */
export async function uploadCourse(goalId: string, fileName: string, base64: string): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    const track = courseFromFile(fileName, bytesOf(base64));
    return courseSaved(await saveCourse(await createClient(), goalId, fileName, track));
  });
}

export async function deleteCourse(goalId: string): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    await removeCourse(await createClient(), goalId);
    return "Course removed. The plan trains for the event's kind again.";
  });
}

/** Fetches the race-day forecast now. */
export async function updateForecast(goalId: string): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    const supabase = await createClient();
    const [course, goals, athlete] = await Promise.all([loadCourse(supabase, goalId), loadGoals(supabase), loadAthlete(supabase)]);
    const goal = goals.find((g) => g.id === goalId);
    if (!course || !goal) throw new Error("That event has no course");
    const { error } = await refreshForecast(supabase, course, goal.date, localDate(new Date(), athlete.timezone), true);
    if (error) throw new Error(`Couldn't get the forecast: ${error}`);
    return "Forecast updated.";
  });
}

/** Sets the event's expected duration to the course's estimate, so the plan's long rides and taper fit it. */
export async function applyCourseDuration(goalId: string, minutes: number): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    const m = Math.round(minutes);
    if (!(m >= 10 && m <= 1440)) throw new Error("That duration doesn't look right");
    const { error } = await (await createClient()).from("training_goals").update({ duration_minutes: m }).eq("id", goalId);
    if (error) throw error;
    return `Event duration set to ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min.`;
  });
}

/** Sets an event's target finish time ("4:30", blank to clear) and how it's ridden ("" for the kind's usual). */
export async function saveRaceTarget(goalId: string, target: string, pack: string): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    const seconds = target.trim() ? parseFinishTime(target) : null;
    if (target.trim() && seconds === null) throw new Error("Give the time as hours and minutes, like 4:30");
    const p = PACKS.includes(pack as Pack) ? (pack as Pack) : null;
    await saveCourseTarget(await createClient(), goalId, seconds, p);
    const how = p ? ` Riding it: ${PACK_LABELS[p].toLowerCase()}.` : "";
    return seconds ? `Target set: ${clock(seconds)}.${how}` : `Target cleared.${how}`;
  });
}

/** Where the rider lives and trains, meters (from what they typed in their units). */
export async function setHomeElevation(meters: number): Promise<ActionResult> {
  return attempt(async () => {
    if (!(Number.isFinite(meters) && meters >= -450 && meters <= 5500)) throw new Error("That elevation doesn't look right");
    await saveHomeElevation(meters);
    return "Saved. Times and watts now allow for the altitude.";
  });
}

/** Measures the rider's own drag from their recent outdoor rides on intervals.icu. */
export async function measureDrag(): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const athlete = await loadAthlete(supabase);
    const d = await measureRiderDrag(supabase, athlete.weightKg);
    const check = d.error !== null ? ` Timed from their own power, the model was within ${Math.max(1, Math.round(d.error * 100))}% on a typical ride.` : "";
    return `Measured from ${d.rides} outdoor rides: drag area ${d.cda.toFixed(2)} m².${check}`;
  });
}

/** Upcoming races and rides named like `text` (BikeReg, US events). */
export async function findEvents(text: string): Promise<{ ok: true; events: EventHit[] } | { ok: false; message: string }> {
  try {
    if (text.trim().length < 3) throw new Error("Type at least three letters of the event's name");
    const athlete = await loadAthlete(await createClient());
    return { ok: true, events: await searchEvents(text, localDate(new Date(), athlete.timezone)) };
  } catch (e) {
    return { ok: false, message: `Couldn't search events: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Course links on an event's listing or website. Empty when there are none or they can't be reached. */
export async function findCourseFor(event: Pick<EventHit, "notes" | "website">): Promise<CourseLink[]> {
  try {
    return await findEventCourse(event);
  } catch {
    return [];
  }
}

/** Attaches a course from a link (Ride with GPS, or a GPX, TCX or FIT file on the web). */
export async function linkCourse(goalId: string, url: string): Promise<ActionResult> {
  return attempt(async () => {
    check(goalId);
    const { name, track } = await courseFromUrl(url);
    return courseSaved(await saveCourse(await createClient(), goalId, name, track));
  });
}
