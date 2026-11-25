"use server";

import { revalidatePath } from "next/cache";
import { appTools } from "@/lib/coach/app-tools";
import { resolveChange, type PlanChange } from "@/lib/coach/changes";
import type { EventEffect, PlanEffect } from "@/lib/coach/event-changes";
import { addDays } from "@/lib/engine/pmc";
import { MAX_INSTRUCTIONS, toPersona, type Persona } from "@/lib/coach/persona";
import { deleteConversation, loadMessage, newConversation, saveProposals } from "@/lib/coach/store";
import { pushChangedPlan, writeDays } from "@/lib/plan-changes";
import { loadTrainingState } from "@/lib/training";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../actions";
import { recordChange, setChangeTitle, type ChangeMeta } from "~/history/changes";

/** Runs an action as one App history entry (src/history); `meta` says who made it. */
async function attempt(work: () => Promise<string>, meta: ChangeMeta = {}): Promise<ActionResult> {
  try {
    const message = await recordChange(meta, work);
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Writes a proposed change, as the engine works it out from today's data. Returns what was done. */
export async function applyChange(supabase: Awaited<ReturnType<typeof createClient>>, change: PlanChange): Promise<string> {
  if (change.kind === "app") {
    const tools = appTools();
    if (!tools) throw new Error("App settings can only be changed in the Lactic desktop app");
    return tools.apply(change.setting);
  }
  const state = await loadTrainingState(supabase);
  const effect = resolveChange(state, change);
  // App history names the entry as the proposal did.
  setChangeTitle(effect.summary.charAt(0).toUpperCase() + effect.summary.slice(1));

  if (effect.kind === "break") {
    const b = effect.break;
    const { error } = await supabase.from("plan_breaks").insert({ start_date: b.start, end_date: b.end, kind: b.kind, riding: b.riding, minutes: b.minutes ?? null, note: b.note ?? "" });
    if (error) throw error;
  } else if (effect.kind === "settings") {
    const { error } = await supabase
      .from("athlete_settings")
      .upsert(
        { user_id: state.athlete.userId, availability: effect.availability, ramp_rate: effect.rampRate, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
  } else if (effect.kind === "days") {
    await writeDays(supabase, state, effect.days);
  } else if (effect.kind === "event") {
    await writeEvent(supabase, state, effect);
  } else if (effect.kind === "plan") {
    await writePlan(supabase, state, effect);
  }
  const pushed = effect.kind === "days" || effect.kind === "event" || effect.kind === "plan" ? await pushChangedPlan(supabase) : "";
  return `Done: ${effect.summary}.${pushed}`;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type State = Awaited<ReturnType<typeof loadTrainingState>>;

/** Adds, changes or removes an event. A moved event takes its plan's end with it, and coach changes in its run-in go back to the plan. */
async function writeEvent(supabase: Supabase, state: State, effect: EventEffect) {
  const g = effect.goal;
  const row = { name: g.name, event_date: g.date, priority: g.priority, kind: g.kind, duration_minutes: g.minutes ?? null, intensity: g.intensity ?? null, start_time: g.startTime ?? null };
  if (effect.action === "remove") {
    const { error } = await supabase.from("training_goals").delete().eq("id", g.id);
    if (error) throw error;
    return;
  }
  if (effect.action === "add") {
    const { error } = await supabase.from("training_goals").insert({ id: crypto.randomUUID(), ...row });
    if (error) throw error;
  } else {
    const { error } = await supabase.from("training_goals").update(row).eq("id", g.id);
    if (error) throw error;
    if (effect.from) {
      for (const p of state.plans.filter((p) => p.goal === "event" && p.goalId === g.id)) {
        const { error: planError } = await supabase.from("training_plans").update({ end_date: g.date, updated_at: new Date().toISOString() }).eq("id", p.id);
        if (planError) throw planError;
      }
    }
  }
  // A day already ridden keeps what was ridden.
  const ridden = new Set(state.storedDays.filter((d) => d.activityId).map((d) => d.day));
  const reset = effect.reset.filter((d) => !ridden.has(d));
  if (reset.length) await writeDays(supabase, state, reset.map((date) => ({ date, session: "reset" as const })));
}

/** Starts, changes or ends a saved plan, as the Plan page does. */
async function writePlan(supabase: Supabase, state: State, effect: PlanEffect) {
  const p = effect.plan;
  const now = new Date().toISOString();
  if (effect.action === "end") {
    const { error } = effect.remove
      ? await supabase.from("training_plans").delete().eq("id", p.id)
      : await supabase.from("training_plans").update({ end_date: addDays(state.today, -1), goal: p.goal === "event" ? "base" : p.goal, updated_at: now }).eq("id", p.id);
    if (error) throw error;
    return;
  }
  const row = { name: p.name, start_date: p.start, end_date: p.end, goal: p.goal, goal_id: p.goalId ?? null, target: p.target ?? null, updated_at: now };
  const { error } = effect.action === "edit" ? await supabase.from("training_plans").update(row).eq("id", p.id) : await supabase.from("training_plans").insert(row);
  if (error) throw error;
}

/**
 * Applies a change the coach proposed. The engine works it out again from today's data, so what's
 * written is the engine's session, not anything the model wrote.
 */
export async function applyProposal(messageId: string, index: number): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const message = await loadMessage(supabase, messageId);
    const proposal = message.proposals[index];
    if (!proposal) throw new Error("That change isn't there any more");
    if (proposal.status !== "pending") throw new Error(`Already ${proposal.status}`);
    const done = await applyChange(supabase, proposal.change);
    await saveProposals(supabase, messageId, message.proposals.map((p, i) => (i === index ? { ...p, status: "applied" } : p)));
    return done;
  }, { author: "coach", toast: true });
}

/**
 * A plugin draft the rider added on its own review screen (src/plugins/draft-card.tsx). Marked
 * applied only when that exact file is what's added now, so this can't stand in for Apply.
 */
export async function markDraftAdded(messageId: string, index: number): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const message = await loadMessage(supabase, messageId);
    const proposal = message.proposals[index];
    const change = proposal?.change;
    if (!proposal || change?.kind !== "app" || change.setting.setting !== "plugin_draft") throw new Error("That plugin draft isn't there any more");
    const { draftIsAdded } = await import("~/plugins/store");
    if (!(await draftIsAdded(change.setting.file))) throw new Error(`${change.setting.name} isn't added`);
    await saveProposals(supabase, messageId, message.proposals.map((p, i) => (i === index ? { ...p, status: "applied" } : p)));
    return `${change.setting.name} is added.`;
  });
}

export async function dismissProposal(messageId: string, index: number): Promise<ActionResult> {
  return attempt(async () => {
    const supabase = await createClient();
    const message = await loadMessage(supabase, messageId);
    if (!message.proposals[index]) throw new Error("That change isn't there any more");
    await saveProposals(supabase, messageId, message.proposals.map((p, i) => (i === index ? { ...p, status: "dismissed" } : p)));
    return "Dismissed.";
  });
}

/** Starts a new conversation (the old one is kept), or returns the current one if it's still empty. */
export async function startConversation(): Promise<ActionResult & { id?: string }> {
  try {
    const conversation = await newConversation(await createClient());
    return { ok: true, message: "Started.", id: conversation.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Deletes a conversation and its messages. What the coach remembers stays. */
export async function removeConversation(id: string): Promise<ActionResult> {
  return attempt(async () => {
    await deleteConversation(await createClient(), id);
    return "Deleted.";
  });
}

const MAX_FACT = 300;

/** Adds a fact for the coach to remember, or changes one when `id` is given. */
export async function saveFact(id: string | null, fact: string): Promise<ActionResult> {
  return attempt(async () => {
    const text = fact.trim();
    if (!text || text.length > MAX_FACT) throw new Error(`Write a fact of up to ${MAX_FACT} characters`);
    const supabase = await createClient();
    const { error } = id
      ? await supabase.from("coach_memory").update({ fact: text, source: "athlete", updated_at: new Date().toISOString() }).eq("id", id)
      : await supabase.from("coach_memory").insert({ fact: text, source: "athlete" });
    if (error) throw error;
    return "Saved.";
  });
}

export async function deleteFact(id: string): Promise<ActionResult> {
  return attempt(async () => {
    const { error } = await (await createClient()).from("coach_memory").delete().eq("id", id);
    if (error) throw error;
    return "Removed.";
  });
}

/** Saves the coach's persona from Settings. */
export async function savePersona(persona: Persona): Promise<ActionResult> {
  return attempt(async () => {
    const clean = toPersona(persona);
    if (persona.instructions.length > MAX_INSTRUCTIONS) throw new Error(`Keep the instructions under ${MAX_INSTRUCTIONS} characters`);
    const { error } = await (await createClient())
      .from("coach_persona")
      .upsert({ name: clean.name, tone: clean.tone, detail: clean.detail, instructions: clean.instructions, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
    return "Saved.";
  });
}
