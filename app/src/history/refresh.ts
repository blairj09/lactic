// After an undo: the open screens load again, and the tab bar follows a layout that came back.

import { loadLayout } from "@/lib/layout-data";
import { setCurrentTabs } from "@/lib/layout-tabs";
import { createClient } from "~/db/supabase-client";
import { revalidatePath } from "~/shims/next-cache";

export async function afterUndo(tables: string[]) {
  if (tables.includes("layouts")) setCurrentTabs((await loadLayout(createClient())).tabs);
  revalidatePath("/", "layout");
}
