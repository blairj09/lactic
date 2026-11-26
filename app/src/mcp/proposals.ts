// Applying or dismissing a change an external AI coach proposed: from the stack in Lactic's corner
// (suggestions.tsx) or from the card the AI app shows beside the proposal (an MCP App, bridge.ts).
// Both go through the same engine path as the built-in coach's Apply.

import { applyChange } from "@/app/coach/actions";
import type { Proposal } from "@/lib/coach/changes";
import { createClient } from "~/db/supabase-client";
import { revalidatePath } from "~/shims/next-cache";
import { recordChange } from "~/history/changes";

/** Tells the stack in Lactic's corner to reload. */
export const PROPOSALS_CHANGED = "lactic:proposals";

export type ProposalStatus = Proposal["status"];

export interface ProposalRow {
  id: string;
  proposal: Proposal;
  status: ProposalStatus;
  client?: string | null;
}

export async function loadProposal(id: string): Promise<ProposalRow | null> {
  const { data } = await createClient().from("coach_proposals").select("id, proposal, status, client").eq("id", id).maybeSingle();
  return (data as ProposalRow | null) ?? null;
}

/**
 * Applies or dismisses a waiting proposal and returns what happened in words. One already decided
 * (in Lactic or another card) is left as it is.
 */
export async function decideProposal(id: string, apply: boolean): Promise<{ status: ProposalStatus; message: string }> {
  const row = await loadProposal(id);
  if (!row) throw new Error("That suggestion is no longer in Lactic.");
  if (row.status !== "pending") return { status: row.status, message: row.status === "applied" ? "Already applied." : "Already dismissed." };
  const supabase = createClient();
  // App history: made by the AI app that suggested it, applied by the rider.
  const message = apply ? await recordChange({ author: "ai_app", client: row.client ?? null }, () => applyChange(supabase, row.proposal.change)) : "Dismissed.";
  const status = apply ? "applied" : "dismissed";
  await supabase.from("coach_proposals").update({ status }).eq("id", id);
  revalidatePath("/");
  globalThis.dispatchEvent?.(new Event(PROPOSALS_CHANGED));
  return { status, message };
}
