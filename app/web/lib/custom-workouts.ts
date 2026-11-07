import { readWorkout } from "@/lib/engine/workout-edit";
import type { Workout } from "@/lib/engine/workout";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A workout saved to My workouts from the Ride page's editor. */
export interface CustomWorkout {
  id: string;
  workout: Workout;
  updatedAt: string;
}

/** My workouts, newest first. Rows that no longer read as a workout are skipped. */
export async function loadCustomWorkouts(supabase: Supabase): Promise<CustomWorkout[]> {
  const { data, error } = await supabase.from("custom_workouts").select("id, name, segments, updated_at").order("updated_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []).flatMap((row) => {
    const workout = readWorkout({ name: row.name, segments: row.segments });
    return workout ? [{ id: row.id as string, workout, updatedAt: row.updated_at as string }] : [];
  });
}
