"use server";

import { revalidatePath } from "next/cache";
import { resolveChange } from "@/lib/coach/changes";
import { MAX_INSTRUCTIONS, toPersona, type Persona } from "@/lib/coach/persona";
import { deleteConversation, loadMessage, newConversation, saveProposals } from "@/lib/coach/store";
import { pushChangedPlan, writeDays } from "@/lib/plan-changes";
import { loadTrainingState } from "@/lib/training";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "../actions";

async function attempt(work: () => Promise<string>): Promise<ActionResult> {
  try {
    const message = await work();
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
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
    const state = await loadTrainingState(supabase);
    const effect = resolveChange(state, proposal.change);

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
    } else {
      await writeDays(supabase, state, effect.days);
    }
    const pushed = effect.kind === "days" ? await pushChangedPlan(supabase) : "";
    await saveProposals(supabase, messageId, message.proposals.map((p, i) => (i === index ? { ...p, status: "applied" } : p)));
    return `Done: ${effect.summary}.${pushed}`;
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
