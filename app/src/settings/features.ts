// Saving and loading what the rider tracks (web/lib/features.ts holds it for the screens).

import { ALL_FEATURES, FEATURES_SETTING, parseFeatures, setCurrentFeatures, type Features } from "@/lib/features";
import { revalidatePath } from "~/shims/next-cache";
import { getSetting, setSetting } from "./store";

/** Reads the saved choice into the app. No saved choice (riders from before it existed) means everything is on. */
export async function loadFeatures(): Promise<Features> {
  const saved = parseFeatures(await getSetting<unknown>(FEATURES_SETTING, ALL_FEATURES).catch(() => ALL_FEATURES));
  setCurrentFeatures(saved);
  return saved;
}

export async function saveFeatures(next: Features) {
  const value = parseFeatures(next);
  await setSetting(FEATURES_SETTING, value);
  setCurrentFeatures(value);
  revalidatePath("/");
}
