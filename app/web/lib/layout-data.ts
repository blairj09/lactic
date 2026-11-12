// Loads and saves the rider's layout (web/lib/sdk/layout.ts) in the `layouts` table. No row means
// the default layout, so riders who never customize have nothing stored. One row per device is
// active; the others are copies kept by Reset or Restore, listed in Settings → Layout.

import { defaultLayout, parseLayout, withNewCards, type Layout } from "./sdk/layout";
import { layoutChanges, sameLayout } from "./sdk/layout-edit";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** "desktop" for the computer, "phone" for the iPhone (the phone follows the computer until changed there). */
export type LayoutDevice = "desktop" | "phone";

/** A layout kept as a copy: its name and, in a few words, how it differs from Lactic's default. */
export interface SavedLayout {
  id: string;
  name: string;
  changes: string[];
  savedAt: string;
}

async function activeRow(supabase: Supabase, device: LayoutDevice): Promise<{ id: string; layout: unknown } | null> {
  const { data, error } = await supabase.from("layouts").select("id, layout").eq("device", device).eq("active", true).order("updated_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as { id: string; layout: unknown } | undefined) ?? null;
}

/** The active layout for a device, checked by parseLayout(); the default when there's none or it can't be read. */
export async function loadLayout(supabase: Supabase, device: LayoutDevice = "desktop"): Promise<Layout> {
  const row = await activeRow(supabase, device).catch(() => null);
  return row ? withNewCards(parseLayout(row.layout)) : defaultLayout();
}

/** Saves the layout as the device's active one. */
export async function saveLayout(supabase: Supabase, layout: Layout, device: LayoutDevice = "desktop"): Promise<void> {
  const value = parseLayout(layout);
  const row = await activeRow(supabase, device);
  const { error } = row
    ? await supabase.from("layouts").update({ layout: value, updated_at: new Date().toISOString() }).eq("id", row.id)
    : await supabase.from("layouts").insert({ device, name: "My layout", layout: value, active: true });
  if (error) throw error;
}

/** "My layout, Nov 12": what a copy is called when Reset or Restore sets it aside. */
export function copyName(now = new Date()): string {
  return `My layout, ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** Sets the active layout aside as a copy (if it differs from the default), leaving no active layout. Returns whether one was kept. */
async function setAside(supabase: Supabase, device: LayoutDevice): Promise<boolean> {
  const row = await activeRow(supabase, device);
  if (!row) return false;
  const custom = !sameLayout(withNewCards(parseLayout(row.layout)), defaultLayout());
  const { error } = await supabase
    .from("layouts")
    .update(custom ? { active: false, name: copyName(), updated_at: new Date().toISOString() } : { active: false, layout: defaultLayout(), name: "Default", updated_at: new Date().toISOString() })
    .eq("id", row.id);
  if (error) throw error;
  return custom;
}

/** Back to Lactic's default. The rider's layout is kept as a copy first (review U5). */
export async function resetLayout(supabase: Supabase, device: LayoutDevice = "desktop"): Promise<{ kept: boolean }> {
  return { kept: await setAside(supabase, device) };
}

/** Copies kept by Reset and Restore, newest first. Copies that match the default are left out. */
export async function listSavedLayouts(supabase: Supabase, device: LayoutDevice = "desktop"): Promise<SavedLayout[]> {
  const { data, error } = await supabase.from("layouts").select("id, name, layout, updated_at").eq("device", device).eq("active", false).order("updated_at", { ascending: false });
  if (error) throw error;
  const base = defaultLayout();
  return ((data ?? []) as { id: string; name: string; layout: unknown; updated_at: string }[])
    .map((r) => ({ id: r.id, name: r.name, changes: layoutChanges(withNewCards(parseLayout(r.layout)), base), savedAt: r.updated_at }))
    .filter((r) => r.changes.length > 0);
}

/** Makes a saved copy the active layout; the one it replaces becomes a copy, so Restore can be undone the same way. */
export async function restoreLayout(supabase: Supabase, id: string, device: LayoutDevice = "desktop"): Promise<void> {
  await setAside(supabase, device);
  const { error } = await supabase.from("layouts").update({ active: true, updated_at: new Date().toISOString() }).eq("id", id).eq("device", device);
  if (error) throw error;
}

/** Deletes a saved copy (never the active layout). */
export async function deleteSavedLayout(supabase: Supabase, id: string): Promise<void> {
  const { error } = await supabase.from("layouts").delete().eq("id", id).eq("active", false);
  if (error) throw error;
}
