"use server";

import { revalidatePath } from "next/cache";
import { localDate } from "@/lib/engine/activity";
import { createClient } from "@/lib/supabase/server";
import { linkOptions, loadTrainingState, plannedOn } from "@/lib/training";
import type { ActionResult } from "../actions";

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d\d-\d\d$/;

/**
 * Sets the plan day a ride counts for (plan_days.activity_id), e.g. an outdoor ride standing in for
 * the day's endurance session or one ridden a day late. `day` null puts it back on the day it was ridden.
 */
export async function countRideFor(rideId: string, day: string | null): Promise<ActionResult> {
  try {
    if (!UUID.test(rideId) || (day !== null && !DAY.test(day))) throw new Error("That isn't a ride and a day");
    const supabase = await createClient();
    const state = await loadTrainingState(supabase);
    const ride = state.rides.find((r) => r.id === rideId);
    if (!ride) throw new Error("Couldn't find that ride (copies count through the ride they copy)");
    const ridden = localDate(ride.startedAt, state.athlete.timezone);
    const now = new Date().toISOString();

    if (day !== null && !linkOptions(state, ridden).some((o) => o.date === day)) {
      throw new Error("It can only count for a planned day within three days of it, through today");
    }
    // A ride counts for one day: let go of any other.
    const others = supabase.from("plan_days").update({ activity_id: null, updated_at: now }).eq("activity_id", rideId);
    const { error: clearError } = await (day === null ? others : others.neq("day", day));
    if (clearError) throw clearError;

    if (day !== null) {
      const stored = state.storedDays.find((d) => d.day === day);
      const session = plannedOn(state, day)?.session ?? null;
      // Recorded as riding the day's session, so its outcome moves that zone's level.
      const chosen = stored?.chosen ?? { option: "asPlanned" as const, session };
      const { error } = stored
        ? await supabase.from("plan_days").update({ activity_id: rideId, chosen, updated_at: now }).eq("day", day)
        : await supabase
            .from("plan_days")
            .insert({ user_id: state.athlete.userId, day, planned: session, chosen, activity_id: rideId, updated_at: now });
      if (error) throw error;
    }
    revalidatePath("/", "layout");
    const label = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
    return { ok: true, message: day && day !== ridden ? `Counts for ${label(day)}'s workout.` : "Counts for the day you rode it." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
