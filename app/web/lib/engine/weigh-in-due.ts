// When to nudge a weekly weigh-in: before the first ride of the week, and only when there's no
// weigh-in from the last week (from Lactic's scale, typed in, or Apple Health).

import { localDate } from "./activity";
import { weekStart } from "./plan";
import { addDays } from "./pmc";

/** A weigh-in this recent (in days, counting today) means no nudge. */
export const WEIGH_IN_FRESH_DAYS = 7;

export type WeighInDue = { due: false } | { due: true; /** Days since the last weigh-in, or null when there's never been one. */ daysSince: number | null };

/**
 * Whether today should ask for a weigh-in. `weighIns` and `rides` are instants in any order;
 * `today` is the rider's local day. Due when no ride has started yet this week (Monday on) and the
 * latest weigh-in is a week old or more.
 */
export function weighInDue(input: { today: string; timeZone: string; weighIns: Date[]; rides: Date[] }): WeighInDue {
  const { today, timeZone } = input;
  const monday = weekStart(today);
  if (input.rides.some((r) => localDate(r, timeZone) >= monday && localDate(r, timeZone) <= today)) return { due: false };
  const days = input.weighIns.map((w) => localDate(w, timeZone)).filter((d) => d <= today);
  if (!days.length) return { due: true, daysSince: null };
  const last = days.reduce((a, b) => (a > b ? a : b));
  if (last > addDays(today, -WEIGH_IN_FRESH_DAYS)) return { due: false };
  return { due: true, daysSince: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000) };
}
