"use server";

import type { RideSets } from "@/lib/ride/field-pages";
import { revalidatePath } from "next/cache";
import { readWorkout } from "@/lib/engine/workout-edit";
import { layoutDevice, loadLayout, saveLayout } from "@/lib/layout-data";
import { parseLayout } from "@/lib/sdk/layout";
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
    const supabase = await createClient();
    const { error } = await supabase.from("custom_workouts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    await supabase.from("workout_favorites").delete().eq("workout_key", `custom:${id}`);
    revalidatePath("/ride");
    return { ok: true, message: "Removed from My workouts." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const FAVORITE_KEY = /^(library:[a-z0-9-]{1,60}|custom:[0-9a-f-]{36})$/i;

/** Adds a workout to favorites or takes it off. `key` is `library:<id>` or `custom:<id>`. */
export async function setFavorite(key: string, favorite: boolean): Promise<{ ok: boolean; message: string }> {
  try {
    if (!FAVORITE_KEY.test(key)) throw new Error("Bad workout key");
    const supabase = await createClient();
    const { error } = favorite
      ? await supabase.from("workout_favorites").upsert({ workout_key: key, updated_at: new Date().toISOString() }, { onConflict: "user_id,workout_key", ignoreDuplicates: true })
      : await supabase.from("workout_favorites").delete().eq("workout_key", key);
    if (error) throw new Error(error.message);
    revalidatePath("/ride");
    revalidatePath("/plan");
    return { ok: true, message: favorite ? "Added to favorites." : "Removed from favorites." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The paired iPhone's ride pages, so this computer works out their numbers too and the phone's
 * remote shows its own pages (the computer's until the phone changes them).
 */
export async function phoneRideFields(): Promise<RideSets | null> {
  try {
    return (await loadLayout(await createClient(), "phone")).ride;
  } catch {
    return null;
  }
}

/**
 * Saves the ride field pages (the field editor's Done). Only the ride part of the layout changes,
 * so Today and the tabs stay as the rider left them. `keepCopy` (after Reset) first saves the
 * layout as it was under a new, inactive name, so it isn't lost.
 */
export async function saveRideFields(input: { ride: unknown; keepCopy?: boolean }): Promise<{ ok: boolean; message: string }> {
  try {
    const supabase = await createClient();
    const current = await loadLayout(supabase);
    const ride = parseLayout({ ...current, ride: input.ride }).ride;
    if (input.keepCopy) {
      const { error } = await supabase.from("layouts").insert({ device: layoutDevice(), name: `Before reset, ${new Date().toISOString().slice(0, 10)}`, layout: current, active: false, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    }
    await saveLayout(supabase, { ...current, ride });
    revalidatePath("/ride");
    return { ok: true, message: "Ride fields saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
