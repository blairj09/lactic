"use server";

// Saving the rider's layout from Customize Today and Settings → Layout (web/lib/layout-data.ts).
// Each change also updates the tab bar right away and redraws the open screens.

import { revalidatePath } from "next/cache";
import { deleteSavedLayout, listSavedLayouts, loadLayout, resetLayout, restoreLayout, saveLayout, type SavedLayout } from "@/lib/layout-data";
import { setCurrentTabs } from "@/lib/layout-tabs";
import { parseLayout, type Layout } from "@/lib/sdk/layout";
import { createClient } from "@/lib/supabase/server";

async function changed() {
  setCurrentTabs((await loadLayout(await createClient())).tabs);
  revalidatePath("/", "layout");
}

export async function saveLayoutAction(layout: Layout): Promise<void> {
  await saveLayout(await createClient(), parseLayout(layout));
  await changed();
}

export async function resetLayoutAction(): Promise<{ kept: boolean }> {
  const result = await resetLayout(await createClient());
  await changed();
  return result;
}

export async function savedLayoutsAction(): Promise<SavedLayout[]> {
  return listSavedLayouts(await createClient());
}

export async function restoreLayoutAction(id: string): Promise<void> {
  await restoreLayout(await createClient(), id);
  await changed();
}

export async function deleteSavedLayoutAction(id: string): Promise<void> {
  await deleteSavedLayout(await createClient(), id);
  revalidatePath("/settings");
}
