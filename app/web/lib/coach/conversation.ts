// The coach's conversations, on the server: chat replies, the morning brief, and keeping each
// conversation's running summary short. Shared by the chat and brief routes.

import { briefInputs, briefStale, coachChat, HISTORY_MESSAGES, KEEP_MESSAGES, morningBrief, planWeek, summarize, type ChatHooks } from "./chat";
import { holdsFavorite, unpickedKeyDays } from "../engine/picks";
import { weekStart } from "../engine/plan";
import { addDays } from "../engine/pmc";
import { openRouter, type Complete } from "./openrouter";
import type { Attachment } from "./attachments";
import { readAttachments } from "./attachments-server";
import {
  applyMemory,
  deleteMessage,
  loadBrief,
  loadReview,
  loadCoachData,
  loadConversation,
  currentConversation,
  loadUnsummarized,
  saveConversationSummary,
  saveMessage,
  type StoredMessage,
} from "./store";
import { weighInOn } from "../body-data";
import { reviewTime, type SnapshotDay, type WeekReview } from "../engine/review";
import { planSnapshot, reviewWeek, type TrainingState } from "../training";
import type { createClient } from "../supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const DEFAULT_MODEL = "moonshotai/kimi-k2";
/** Summarize once this many messages are waiting, keeping the newest KEEP_MESSAGES verbatim. */
const SUMMARIZE_AT = 30;

export function coachModel(): { complete: Complete; model: string } | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return { complete: openRouter(apiKey, model, { maxTokens: 1500 }), model };
}

/**
 * Answers a chat message in a conversation (the current one if not given): reads its attachments,
 * saves it, runs the coach, saves the reply and any memory changes. `page` is the page it was sent from.
 */
export async function answer(
  supabase: Supabase,
  text: string,
  hooks: ChatHooks,
  page?: string | null,
  conversationId?: string | null,
  attachments: Attachment[] = [],
): Promise<StoredMessage> {
  const coach = coachModel();
  if (!coach) throw new Error("The coach needs OPENROUTER_API_KEY");
  const [conversation, data] = await Promise.all([conversationId ? loadConversation(supabase, conversationId) : currentConversation(supabase), loadCoachData(supabase)]);
  const read = await readAttachments(supabase, attachments, data.state.athlete, text, hooks.onStatus);
  await saveMessage(supabase, conversation, { role: "user", content: text, attachments: read });
  const history = await loadUnsummarized(supabase, conversation, HISTORY_MESSAGES);
  const reply = await coachChat(coach.complete, data, history, conversation.summary, hooks, page);
  const saved = await saveMessage(supabase, conversation, { role: "assistant", content: reply.message, proposals: reply.proposals, model: coach.model, ...(reply.feedback ? { meta: { feedback: reply.feedback } } : {}) });
  if (reply.memory.length) await applyMemory(supabase, reply.memory);
  return saved;
}

/**
 * Today's brief: the stored one, unless today's recovery or a weigh-in has arrived since it was
 * written, in which case it's written again (as long as none of its proposals has been acted on).
 */
export async function brief(supabase: Supabase, hooks: ChatHooks): Promise<StoredMessage> {
  const coach = coachModel();
  if (!coach) throw new Error("The coach needs OPENROUTER_API_KEY");
  // Key days without a workout picked get one first, so the brief can say what today is for.
  try {
    await planAhead(supabase, { onStatus: hooks.onStatus });
  } catch (e) {
    console.error("Couldn't pick the week's workouts", e);
  }
  const data = await loadCoachData(supabase);
  const today = data.state.today;
  const inputs = briefInputs(data.state, Boolean(weighInOn(data.body, today, data.state.athlete.timezone)));
  const existing = await loadBrief(supabase, today);
  if (existing && !briefStale(existing, inputs)) return existing;
  // A rewrite stays in the brief's conversation; a new brief goes to the current one.
  const conversation = existing?.conversationId ? await loadConversation(supabase, existing.conversationId) : await currentConversation(supabase);
  const history = await loadUnsummarized(supabase, conversation, 6);
  const reply = await morningBrief(coach.complete, data, history, conversation.summary, hooks);
  // Changes you've already applied or dismissed stay with the rewritten brief.
  const settled = existing?.proposals.filter((p) => p.status !== "pending") ?? [];
  const proposals = [...settled, ...reply.proposals.filter((p) => !settled.some((s) => JSON.stringify(s.change) === JSON.stringify(p.change)))];
  if (existing) await deleteMessage(supabase, existing.id);
  return saveMessage(supabase, conversation, {
    role: "assistant",
    kind: "brief",
    day: today,
    content: reply.message,
    proposals,
    model: coach.model,
    meta: { ...inputs, ...(reply.today ? { today: reply.today } : {}) },
  });
}

/** Don't run the weekly planning more often than this on its own (a failed or partial run waits too). */
const PLAN_EVERY_HOURS = 12;

/**
 * The weekly planning run: the coach picks a workout for each key day from today through the end of
 * next week that doesn't have one (every key day in that window when `all`). Picks are saved and laid
 * over the plan on the next load, and the coach's summary goes into the conversation. In the first
 * days of a week the same run writes the review of the week before (review.ts), which Today shows.
 * Returns how many days it picked. Picking runs on its own at most every PLAN_EVERY_HOURS unless `all`
 * or a review is due.
 */
export async function planAhead(supabase: Supabase, hooks: ChatHooks = {}, { all = false } = {}): Promise<number> {
  const coach = coachModel();
  if (!coach) return 0;
  // Nowhere to keep picks until the coach_picks migration is applied.
  const { error: missing } = await supabase.from("coach_picks").select("day").limit(1);
  if (missing) return (console.error(missing), 0);
  const data = await loadCoachData(supabase);
  const { state } = data;
  const monday = weekStart(state.today);
  await keepSnapshot(supabase, state, monday);
  const review = await reviewDue(supabase, state, monday);
  const through = addDays(monday, 13);
  // Days you changed yourself (or applied a coach change to) keep that session, and days holding one of your
  // favorites keep it, so there's nothing to pick.
  const days = (
    all
      ? state.basePlan.weeks.flatMap((w) => w.days).filter((d) => d.date >= state.today && d.date <= through && d.role === "key" && d.session && !d.goal && !holdsFavorite(d))
      : unpickedKeyDays(state.basePlan, state.picks ?? [], state.today, through, state.customWorkouts ?? [])
  ).filter((d) => !state.changedDays.includes(d.date));
  if (days.length === 0 && !review) return 0;
  if (!all && !review && (await plannedSince(supabase, new Date(Date.now() - PLAN_EVERY_HOURS * 3600_000)))) return 0;

  hooks.onStatus?.(review ? "Looking back at last week" : "Picking the workouts for the days ahead");
  const conversation = await currentConversation(supabase);
  const reply = await planWeek(coach.complete, data, days, conversation.summary, { onStatus: hooks.onStatus }, review);
  if (reply.picks.length) {
    const rows = reply.picks.map((p) => ({ day: p.date, template: p.template, tweaks: p.tweaks ?? {}, reason: p.reason, model: coach.model, created_at: new Date().toISOString() }));
    const { error } = await supabase.from("coach_picks").upsert(rows, { onConflict: "user_id,day" });
    if (error) throw error;
  }
  await saveMessage(supabase, conversation, {
    role: "assistant",
    content: reply.message,
    model: coach.model,
    meta: { plannedWeek: true, picked: reply.picks.map((p) => p.date), ...(review ? { reviewOf: review.start, review } : {}) },
  });
  return reply.picks.length;
}

/** Keeps what this week is planned to be, the first time it's seen, for next week's review. */
async function keepSnapshot(supabase: Supabase, state: TrainingState, monday: string) {
  const { data, error } = await supabase.from("plan_snapshots").select("week").eq("week", monday).limit(1);
  // The table isn't there until its migration is applied; the review then goes by stored days only.
  if (error) return console.error(error);
  if (data.length) return;
  const { error: saveError } = await supabase.from("plan_snapshots").upsert({ week: monday, days: planSnapshot(state, monday) }, { onConflict: "user_id,week", ignoreDuplicates: true });
  if (saveError) console.error(saveError);
}

/** Last week's review, when it's the start of the week, it isn't written yet and there was something to review. */
async function reviewDue(supabase: Supabase, state: TrainingState, monday: string): Promise<WeekReview | null> {
  const last = addDays(monday, -7);
  if (!reviewTime(state.today, monday) || (await loadReview(supabase, last))) return null;
  const review = reviewWeek(state, last, await loadSnapshot(supabase, last));
  return review.planned > 0 || review.rides > 0 ? review : null;
}

async function loadSnapshot(supabase: Supabase, monday: string): Promise<SnapshotDay[]> {
  const { data, error } = await supabase.from("plan_snapshots").select("days").eq("week", monday).maybeSingle();
  if (error) return (console.error(error), []);
  return Array.isArray(data?.days) ? data.days : [];
}

async function plannedSince(supabase: Supabase, since: Date): Promise<boolean> {
  const { data, error } = await supabase.from("coach_messages").select("id").contains("meta", { plannedWeek: true }).gte("created_at", since.toISOString()).limit(1);
  if (error) throw error;
  return data.length > 0;
}

/** Folds older messages into the summary once enough are waiting. Failures only cost a longer prompt. */
export async function keepSummaryShort(supabase: Supabase, conversationId: string) {
  const coach = coachModel();
  if (!coach) return;
  try {
    const conversation = await loadConversation(supabase, conversationId);
    const waiting = await loadUnsummarized(supabase, conversation, 500);
    if (waiting.length < SUMMARIZE_AT) return;
    const fold = waiting.slice(0, waiting.length - KEEP_MESSAGES);
    const summary = await summarize(coach.complete, conversation.summary, fold);
    await saveConversationSummary(supabase, conversation.id, { summary, summarizedThrough: fold[fold.length - 1].createdAt });
  } catch (e) {
    console.error("Couldn't update the coach summary", e);
  }
}

/** A check-in goes into the conversation too; the brief rewritten from it is the coach's answer. */
export async function recordCheckin(supabase: Supabase, day: string, athlete: string) {
  try {
    await saveMessage(supabase, await currentConversation(supabase), { role: "user", kind: "checkin", day, content: athlete });
  } catch (e) {
    console.error("Couldn't add the check-in to the coach chat", e);
  }
}

/** Your choice after a check-in, as a line in the conversation. */
export async function recordChoice(supabase: Supabase, day: string, text: string) {
  try {
    await saveMessage(supabase, await currentConversation(supabase), { role: "user", kind: "checkin", day, content: text });
  } catch (e) {
    console.error("Couldn't add the choice to the coach chat", e);
  }
}
