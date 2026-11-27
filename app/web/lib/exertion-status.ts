// Where today's exertion stands against its target, in words: the Exertion tile on Today and the
// Apple Watch's Exertion widget say the same thing. The engine owns the numbers; this only words them.

import type { ExertionToday } from "./engine/recovery-glance";

export interface ExertionStatus {
  /** "1.4 to target", "Target reached" or "Over target"; null without a target. */
  text: string | null;
  over: boolean;
}

export function exertionStatus({ soFar, target }: Pick<ExertionToday, "soFar" | "target">): ExertionStatus {
  const now = soFar ?? 0;
  if (!target) return { text: null, over: false };
  if (now > target.high) return { text: "Over target", over: true };
  if (now >= target.low) return { text: "Target reached", over: false };
  return { text: `${(target.low - now).toFixed(1)} to target`, over: false };
}
