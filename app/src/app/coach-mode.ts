// The coach mode, for components that show or hide coach pieces.

import { useEffect, useState } from "react";
import { coachSetup, type CoachMode } from "~/ai/settings";

let cached: CoachMode = "none";
const listeners = new Set<(m: CoachMode) => void>();

export async function refreshCoachMode() {
  cached = (await coachSetup()).mode;
  listeners.forEach((l) => l(cached));
  document.documentElement.toggleAttribute("data-coach", cached === "builtin");
}

export function useCoachMode(): CoachMode {
  const [mode, setMode] = useState(cached);
  useEffect(() => {
    listeners.add(setMode);
    return () => void listeners.delete(setMode);
  }, []);
  return mode;
}
