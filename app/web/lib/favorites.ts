import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Favorite workout keys (`library:<id>` or `custom:<id>`), newest first. */
export async function loadFavorites(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase.from("workout_favorites").select("workout_key, created_at").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => row.workout_key as string);
}
