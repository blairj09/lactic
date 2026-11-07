// Writing changed days of the plan, from the coach's proposals and from the Plan page. A changed day's
// session goes into plan_days.planned, which is laid over the rebuilt plan on every load
// (engine/overrides.ts), so it survives the engine rebuilding the plan and the coach's weekly picks.

import type { Session } from "./engine/library";
import { pushPlan } from "./intervals/push";
import { loadConnection } from "./intervals/client";
import { loadPlanDays, loadTrainingState, type TrainingState } from "./training";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The session for each day (null for rest), or "reset" to go back to the plan's. */
export type DayWrite = { date: string; session: Session | null | "reset" };

export async function writeDays(supabase: Supabase, state: Pick<TrainingState, "athlete" | "basePlan">, days: DayWrite[]): Promise<void> {
  const dates = days.map((d) => d.date).sort();
  const stored = await loadPlanDays(supabase, dates[0], dates[dates.length - 1]);
  for (const { date } of days) {
    const row = stored.find((d) => d.day === date);
    if (row?.activityId) throw new Error(`You've already ridden ${date}'s session`);
  }
  const now = new Date().toISOString();
  for (const { date, session } of days) {
    const row = stored.find((d) => d.day === date);
    if (session === "reset") {
      if (!row) continue;
      // Keep a check-in; otherwise the row only held the change.
      const base = state.basePlan.weeks.flatMap((w) => w.days).find((d) => d.date === date)?.session ?? null;
      const { error } = row.checkin
        ? await supabase.from("plan_days").update({ planned: base, chosen: null, updated_at: now }).eq("day", date)
        : await supabase.from("plan_days").delete().eq("day", date);
      if (error) throw error;
    } else {
      // A changed day goes into `planned`, so the check-in on the day offers versions of it.
      const { error } = await supabase
        .from("plan_days")
        .upsert({ user_id: state.athlete.userId, day: date, planned: session, chosen: null, updated_at: now }, { onConflict: "user_id,day" });
      if (error) throw error;
    }
  }
}

/**
 * Sends the changed plan to the intervals.icu calendar. Returns a line to add to the result, empty
 * when intervals.icu isn't connected; a failed push is logged and said, but doesn't undo the change.
 */
export async function pushChangedPlan(supabase: Supabase): Promise<string> {
  try {
    const connection = await loadConnection(supabase);
    if (!connection) return "";
    const state = await loadTrainingState(supabase);
    await pushPlan(connection.apiKey, state.plan, state.goals, state.today, state.outdoor);
    return " Sent to intervals.icu.";
  } catch (e) {
    console.error("intervals.icu plan push failed:", e);
    return " intervals.icu didn't take it; Send plan to calendar in Settings → Connections tries again.";
  }
}
