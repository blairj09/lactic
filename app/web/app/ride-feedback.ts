"use server";

import { revalidatePath } from "next/cache";
import { loadAthlete } from "@/lib/activities";
import { recordChoice } from "@/lib/coach/conversation";
import { localDate } from "@/lib/engine/activity";
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty } from "@/lib/engine/feedback";
import { ZONES, type Session } from "@/lib/engine/library";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The post-ride survey. The ride is a stored ride's id, or for a ride just saved on the Ride page,
 * its start time. `session` is the library workout ridden, so it can move that zone's level.
 */
export async function saveRideFeedback(input: {
  rideId?: string;
  appStartedAt?: string;
  difficulty: Difficulty;
  rpe: number | null;
  note: string;
  session?: Pick<Session, "zone" | "level" | "duration" | "stress"> | null;
}): Promise<ActionResult> {
  try {
    if (!DIFFICULTIES.includes(input.difficulty)) throw new Error("Pick how hard it was");
    const rpe = input.rpe === null || input.rpe === undefined ? null : Math.round(Number(input.rpe));
    if (rpe !== null && !(rpe >= 1 && rpe <= 10)) throw new Error("RPE is 1 to 10");
    const note = String(input.note ?? "").trim().slice(0, 1000);
    const s = input.session;
    const session =
      s && ZONES.includes(s.zone) && [s.level, s.duration, s.stress].every((n) => typeof n === "number" && Number.isFinite(n))
        ? { zone: s.zone, level: s.level, duration: s.duration, stress: s.stress }
        : null;

    const supabase = await createClient();
    let query = supabase.from("activities").select("id, name, started_at");
    if (input.rideId && UUID.test(input.rideId)) query = query.eq("id", input.rideId);
    else if (input.appStartedAt && !Number.isNaN(Date.parse(input.appStartedAt))) query = query.eq("source", "app").eq("external_id", input.appStartedAt);
    else throw new Error("Which ride?");
    const { data: ride, error } = await query.maybeSingle();
    if (error) throw error;
    if (!ride) throw new Error("Couldn't find that ride");

    const { error: saveError } = await supabase
      .from("ride_feedback")
      .upsert({ activity_id: ride.id, difficulty: input.difficulty, rpe, note, session, updated_at: new Date().toISOString() }, { onConflict: "activity_id" });
    if (saveError) throw saveError;

    const athlete = await loadAthlete(supabase);
    const line = [`After ${ride.name ?? "my ride"}: ${DIFFICULTY_LABELS[input.difficulty].toLowerCase()}`, rpe ? `, RPE ${rpe}/10` : "", note ? `. "${note}"` : "", "."].join("");
    await recordChoice(supabase, localDate(new Date(ride.started_at), athlete.timezone), line);
    revalidatePath("/", "layout");
    return { ok: true, message: "Thanks. Your plan and the coach will take it into account." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
