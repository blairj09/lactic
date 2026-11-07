// Database reads and writes for the coach chat: what the coach can see, and the conversation.

import { loadBodyMeasurements } from "../body-data";
import { addDays } from "../engine/pmc";
import { loadPlanDays, loadTrainingState } from "../training";
import type { createClient } from "../supabase/server";
import { ATTACHMENT_BUCKET, type Attachment } from "./attachments";
import { createAdminClient } from "../supabase/admin";
import type { Proposal } from "./changes";
import { titleFrom } from "./chat";
import { toPersona, type Persona } from "./persona";
import type { CoachData, MemoryFact, MemoryOp, RecoveryDay } from "./tools";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const HISTORY_DAYS = 730;

export type MessageKind = "chat" | "brief" | "checkin";

export interface StoredMessage {
  id: string;
  conversationId: string | null;
  role: "user" | "assistant";
  kind: MessageKind;
  /** The day a brief or check-in is for. */
  day: string | null;
  content: string;
  proposals: Proposal[];
  meta: Record<string, unknown>;
  /** Files and images sent with a message, and what the coach read from them. */
  attachments?: Attachment[];
  createdAt: string;
}

const COLUMNS = "id, conversation_id, role, kind, day, content, proposals, meta, attachments, created_at";

/** Everything the coach can read: the training state plus two years of check-ins, recovery and weigh-ins. */
export async function loadCoachData(supabase: Supabase): Promise<CoachData> {
  const state = await loadTrainingState(supabase);
  const since = addDays(state.today, -HISTORY_DAYS);
  const [planDays, recoveryDays, body, memory, persona] = await Promise.all([
    loadPlanDays(supabase, since, addDays(state.today, 60)),
    loadRecoveryDays(supabase, since),
    loadBodyMeasurements(supabase, new Date(`${since}T00:00:00Z`)),
    loadMemory(supabase),
    loadPersona(supabase),
  ]);
  return { state, planDays, recoveryDays, body, memory, persona };
}

async function loadRecoveryDays(supabase: Supabase, since: string): Promise<RecoveryDay[]> {
  const { data, error } = await supabase.from("recovery_days").select("day, hrv_ms, hrv_kind, resting_hr, sleep_hours, sleep_deep_hours, sleep_rem_hours, sleep_awake_hours, wrist_temp_c, respiratory_rate").gte("day", since).order("day", { ascending: false });
  if (error) throw error;
  const num = (v: string | number | null) => (v === null ? null : Number(v));
  return data.map((r) => ({ day: r.day, hrvMs: num(r.hrv_ms), hrvKind: r.hrv_kind, restingHr: num(r.resting_hr), sleepHours: num(r.sleep_hours),
    deepHours: num(r.sleep_deep_hours),
    remHours: num(r.sleep_rem_hours),
    awakeHours: num(r.sleep_awake_hours),
    wristTempC: num(r.wrist_temp_c),
    respiratoryRate: num(r.respiratory_rate),
  }));
}

// Rows come back untyped from the client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toMessage = (r: any): StoredMessage => ({
  id: r.id,
  conversationId: r.conversation_id ?? null,
  role: r.role,
  kind: r.kind ?? "chat",
  day: r.day ?? null,
  content: r.content,
  proposals: r.proposals ?? [],
  meta: r.meta ?? {},
  ...(Array.isArray(r.attachments) && r.attachments.length ? { attachments: r.attachments } : {}),
  createdAt: r.created_at,
});

/** A conversation with the coach. Memory is shared by all of them; the summary is its own. */
export interface Conversation {
  id: string;
  title: string;
  summary: string;
  summarizedThrough: string | null;
  createdAt: string;
  updatedAt: string;
}

const CONVERSATION_COLUMNS = "id, title, summary, summarized_through, created_at, updated_at";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toConversation = (r: any): Conversation => ({
  id: r.id,
  title: r.title,
  summary: r.summary,
  summarizedThrough: r.summarized_through,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Conversations, the current (most recently active) one first. */
export async function listConversations(supabase: Supabase, limit = 50): Promise<Conversation[]> {
  const { data, error } = await supabase.from("coach_conversations").select(CONVERSATION_COLUMNS).order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.map(toConversation);
}

export async function loadConversation(supabase: Supabase, id: string): Promise<Conversation> {
  const { data, error } = await supabase.from("coach_conversations").select(CONVERSATION_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return toConversation(data);
}

/** The conversation briefs, check-ins and new messages go to: the most recently active, or a new one. */
export async function currentConversation(supabase: Supabase): Promise<Conversation> {
  return (await listConversations(supabase, 1))[0] ?? createConversation(supabase);
}

/** Starts a conversation, unless the current one is still empty, which is used instead. */
export async function newConversation(supabase: Supabase): Promise<Conversation> {
  const [current] = await listConversations(supabase, 1);
  if (current) {
    const { count, error } = await supabase.from("coach_messages").select("id", { count: "exact", head: true }).eq("conversation_id", current.id);
    if (error) throw error;
    if (!count) return current;
  }
  return createConversation(supabase);
}

async function createConversation(supabase: Supabase): Promise<Conversation> {
  const { data, error } = await supabase.from("coach_conversations").insert({}).select(CONVERSATION_COLUMNS).single();
  if (error) throw error;
  return toConversation(data);
}

/** Deletes a conversation, its messages, and the files attached to them. */
export async function deleteConversation(supabase: Supabase, id: string) {
  const { data: files } = await supabase.from("coach_messages").select("attachments").eq("conversation_id", id).not("attachments", "is", null);
  const { error } = await supabase.from("coach_conversations").delete().eq("id", id);
  if (error) throw error;
  const paths = (files ?? []).flatMap((m) => (Array.isArray(m.attachments) ? m.attachments.map((a: { path: string }) => a.path) : []));
  // Only the secret key can remove files (the bucket lets you read and add your own); without it they stay, unseen.
  if (paths.length) await createAdminClient()?.storage.from(ATTACHMENT_BUCKET).remove(paths).then(({ error }) => error && console.error(error));
}

export async function saveConversationSummary(supabase: Supabase, id: string, summary: { summary: string; summarizedThrough?: string | null }) {
  const { error } = await supabase
    .from("coach_conversations")
    .update({ summary: summary.summary, ...(summary.summarizedThrough !== undefined ? { summarized_through: summary.summarizedThrough } : {}) })
    .eq("id", id);
  if (error) throw error;
}

/** A conversation's latest messages, oldest first. */
export async function loadMessages(supabase: Supabase, conversationId: string, limit = 100): Promise<StoredMessage[]> {
  const { data, error } = await supabase.from("coach_messages").select(COLUMNS).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data.reverse().map(toMessage);
}

/** A conversation's messages not yet folded into its summary, oldest first, at most `limit` of the newest. */
export async function loadUnsummarized(supabase: Supabase, conversation: Conversation, limit: number): Promise<StoredMessage[]> {
  let query = supabase.from("coach_messages").select(COLUMNS).eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(limit);
  if (conversation.summarizedThrough) query = query.gt("created_at", conversation.summarizedThrough);
  const { data, error } = await query;
  if (error) throw error;
  return data.reverse().map(toMessage);
}

/** Adds a message to a conversation, marks it active, and titles it from the first message you send. */
export async function saveMessage(
  supabase: Supabase,
  conversation: Conversation,
  message: { role: "user" | "assistant"; content: string; kind?: MessageKind; day?: string; proposals?: Proposal[]; model?: string; meta?: Record<string, unknown>; attachments?: Attachment[] },
): Promise<StoredMessage> {
  const { data, error } = await supabase
    .from("coach_messages")
    .insert({
      conversation_id: conversation.id,
      role: message.role,
      kind: message.kind ?? "chat",
      day: message.day ?? null,
      content: message.content.slice(0, 20000),
      proposals: message.proposals ?? [],
      model: message.model ?? null,
      meta: message.meta ?? {},
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const saved = toMessage(data);
  const title = !conversation.title && message.role === "user" && (message.kind ?? "chat") === "chat" ? titleFrom(message.content || message.attachments?.map((a) => a.name).join(", ") || "") || null : null;
  if (title) conversation.title = title;
  const { error: touchError } = await supabase
    .from("coach_conversations")
    .update({ updated_at: saved.createdAt, ...(title ? { title } : {}) })
    .eq("id", conversation.id);
  if (touchError) throw touchError;
  return saved;
}


export async function loadMessage(supabase: Supabase, id: string): Promise<StoredMessage> {
  const { data, error } = await supabase.from("coach_messages").select(COLUMNS).eq("id", id).single();
  if (error) throw error;
  return toMessage(data);
}

/** The brief for a day, if one was written. */
export async function loadBrief(supabase: Supabase, day: string): Promise<StoredMessage | null> {
  const { data, error } = await supabase.from("coach_messages").select(COLUMNS).eq("kind", "brief").eq("day", day).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data.length ? toMessage(data[0]) : null;
}

export async function deleteMessage(supabase: Supabase, id: string) {
  const { error } = await supabase.from("coach_messages").delete().eq("id", id);
  if (error) throw error;
}

export async function saveProposals(supabase: Supabase, id: string, proposals: Proposal[]) {
  const { error } = await supabase.from("coach_messages").update({ proposals }).eq("id", id);
  if (error) throw error;
}

export async function loadMemory(supabase: Supabase): Promise<MemoryFact[]> {
  const { data, error } = await supabase.from("coach_memory").select("id, fact, source").order("created_at");
  if (error) throw error;
  return data;
}

export async function applyMemory(supabase: Supabase, ops: MemoryOp[]) {
  for (const op of ops) {
    const { error } =
      op.op === "add" ? await supabase.from("coach_memory").insert({ fact: op.fact, source: "coach" }) : await supabase.from("coach_memory").delete().eq("id", op.id);
    if (error) throw error;
  }
}

export async function loadPersona(supabase: Supabase): Promise<Persona> {
  const { data, error } = await supabase.from("coach_persona").select("name, tone, detail, instructions").maybeSingle();
  if (error) throw error;
  return toPersona(data);
}

/** The coach's review of the week starting `monday`, if it wrote one (conversation.ts planAhead). */
export async function loadReview(supabase: Supabase, monday: string): Promise<StoredMessage | null> {
  const { data, error } = await supabase.from("coach_messages").select(COLUMNS).contains("meta", { reviewOf: monday }).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data.length ? toMessage(data[0]) : null;
}
