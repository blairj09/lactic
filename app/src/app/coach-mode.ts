// The coach mode, for components that show or hide coach pieces.

import { useEffect, useState } from "react";
import { coachSetup, mcpOn, type CoachMode } from "~/ai/settings";

let cached: CoachMode = "none";
let mcp = false;
const listeners = new Set<(m: CoachMode) => void>();
const mcpListeners = new Set<(on: boolean) => void>();

export async function refreshCoachMode() {
  const setup = await coachSetup();
  cached = setup.mode;
  mcp = mcpOn(setup);
  listeners.forEach((l) => l(cached));
  mcpListeners.forEach((l) => l(mcp));
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

/** Whether AI apps can coach over MCP: the external mode, or alongside the built-in coach. */
export function useMcpOn(): boolean {
  const [on, setOn] = useState(mcp);
  useEffect(() => {
    mcpListeners.add(setOn);
    return () => void mcpListeners.delete(setOn);
  }, []);
  return on;
}
