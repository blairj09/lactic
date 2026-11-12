// Loads and saves the rider's layout (web/lib/sdk/layout.ts) in the `layouts` table. No row means
// the default layout, so riders who never customize have nothing stored.

import { defaultLayout, parseLayout, withNewCards, type Layout } from "./sdk/layout";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** "desktop" for the computer, "phone" for the iPhone (the phone follows the computer until changed there). */
export type LayoutDevice = "desktop" | "phone";

/** The active layout for a device, checked by parseLayout(); the default when there's none or it can't be read. */
export async function loadLayout(supabase: Supabase, device: LayoutDevice = "desktop"): Promise<Layout> {
  const { data, error } = await supabase.from("layouts").select("layout").eq("device", device).eq("active", true).order("updated_at", { ascending: false }).limit(1);
  if (error || !data?.length) return defaultLayout();
  return withNewCards(parseLayout(data[0].layout));
}
