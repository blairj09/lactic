"use server";

import { revalidatePath } from "next/cache";
import { readWorkout } from "@/lib/engine/workout-edit";
import { createClient } from "@/lib/supabase/server";

export type SaveWorkoutResult = { ok: true; id: string; message: string } | { ok: false; message: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** Saves a workout to My workouts: updates `id` when given, else adds a new one. */
export async function saveCustomWorkout(input: { id?: string; workout: unknown }): Promise<SaveWorkoutResult> {
  try {
    const workout = readWorkout(input.workout);
    if (!workout) throw new Error("That workout can't be saved");
    const supabase = await createClient();
    const row = { name: workout.name, segments: workout.segments, updated_at: new Date().toISOString() };
    const { data, error } =
      input.id && UUID.test(input.id)
        ? await supabase.from("custom_workouts").update(row).eq("id", input.id).select("id").single()
        : await supabase.from("custom_workouts").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    revalidatePath("/ride");
    return { ok: true, id: data.id as string, message: `Saved “${workout.name}” to My workouts.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCustomWorkout(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    if (!UUID.test(id)) throw new Error("Bad workout id");
    const { error } = await (await createClient()).from("custom_workouts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/ride");
    return { ok: true, message: "Removed from My workouts." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
