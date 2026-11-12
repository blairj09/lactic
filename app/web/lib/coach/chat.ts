// The coach chat: a conversation about your training, with read access to everything in the app
// through tools. Like the check-in coach, it reads engine outputs and never computes metrics or
// writes workouts; plan changes are proposals the engine has checked, applied only when you press Apply.
// It keeps a short list of lasting facts about you and a running summary of older conversation.

import type { ChatMessage, Complete } from "./openrouter";
import type { Proposal } from "./changes";
import type { StoredMessage } from "./store";
import { DEFAULT_PERSONA, personaPrompt } from "./persona";
import { describeDay, type PlanDay } from "../engine/plan";
import type { WorkoutPick } from "../engine/picks";
import type { WeekReview } from "../engine/review";
import { DIFFICULTY_LABELS } from "../engine/feedback";
import { ZONE_LABELS } from "../engine/library";
import type { OptionId } from "../engine/checkin";
import { attachmentNames, turnsForModel, type Attachment } from "./attachments";
import { appTools } from "./app-tools";
import { APP_GUIDE } from "./app-guide";
import { FEEDBACK_TOOLS, forFeatures, MEMORY_TOOLS, PICK_TOOLS, READ_TOOL_NAMES, runTool, status, TODAY_TOOLS, TOOLS, type CoachData, type FeedbackDraft, type MemoryOp } from "./tools";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** Files and images the athlete sent with the message, with what was read from them. */
  attachments?: Attachment[];
  /** A saved message's extras; `feedback` marks a reply that offered to send feedback. */
  meta?: Record<string, unknown>;
}

export interface ChatReply {
  message: string;
  proposals: Proposal[];
  memory: MemoryOp[];
  /** Workouts chosen in the weekly planning run. */
  picks: WorkoutPick[];
  /** The brief's suggestion among today's options. */
  today?: OptionId;
  /** Feedback about Lactic the coach offered to send, shown as a button under the reply. */
  feedback?: FeedbackDraft;
}

export interface ChatHooks {
  /** Which tools are running, for the page to show while it waits. */
  onStatus?: (text: string) => void;
  /** Reply text as it streams. */
  onText?: (delta: string) => void;
  /** A new model call is starting: text streamed so far was thinking aloud before tool calls, so drop it. */
  onTurn?: () => void;
}

const RULES = `How you work:
- The status below is current. Use the tools for anything else, and look things up rather than guessing. Use several tools when a question needs them.
- Every number you mention comes from the status, a tool result or a file the athlete attached. Never estimate, compute or invent metrics, watts, durations, TSS or workouts yourself. If the data isn't there, say so.
- Be specific, like a good coach texting their athlete, in the tone and length the persona below sets (a length given for a particular message wins). Plain paragraphs; a short list only when it really helps. No headings, tables or emoji.
- Not medical advice: for chest pain, fainting, injury or illness that worries them, tell them to see a doctor.`;

const CHAT = `You are the cycling coach inside Lactic, a training app for one athlete. You talk with them about their training: rides, the plan, fitness, recovery, body weight, events and anything else in the app. The conversation includes how they said they feel each morning and your morning briefs.

${RULES}
- You can't edit the plan. To change it, call get_day_options and then propose_day_change, or propose_swap, propose_reset_day or propose_availability. For a different kind of workout (over-unders, surges, 30/30s, attacks, race starts and more) or specific targets in one, or a fixed workout from Lactic's library or the athlete's own saved workouts, call get_workouts and then propose_workout. Favorites are workouts the athlete liked: suggest one that suits the day before others. When they mention travel, a holiday, illness or time off the bike, use propose_break. Plans (dates and goal) are built on the Plan page; you can read the saved plan and breaks in the status and get_plan. The engine checks each proposal and builds the sessions, and the athlete applies it with a button. Only propose a change when they ask for one or clearly need one, and say in your reply what you proposed.
- The athlete can attach files to a message. You get each as text after their words: an image as a vision model's description of it (you can't see it yourself, so go by the description and say if something seems missing or unclear), a PDF or text file as its text, a .fit ride file as the engine's summary, a GPX route as its distance and climbing. A ride file isn't saved by attaching it; rides arrive through intervals.icu.
- Events are changed on the Plan page. Settings (profile, coach, gear, syncing) you can change for them with propose_app_change, which they apply with a button; see "How Lactic works" below.
- Questions about Lactic itself (where something is, what it can do, how it looks) are yours to answer too, from "How Lactic works" below. When they ask for light or dark mode, set it with set_appearance and say it's done.
- When the app has check_app, you can also help with the app itself: Bluetooth gear that won't connect or drops, intervals.icu or Apple Health not syncing, the coach's own setup. Call check_app first and go by what it says (the activity log and the guide included) rather than guessing. You can then try things that change no setting (test_connection, sync_now, reconnect_device, scan_for_devices) and say what you did and what happened. For a settings change use propose_app_change; the athlete applies it with a button. You never see API keys: when a key is wrong, send them to the Settings page to paste a new one. Pairing new gear happens in Settings → Bluetooth. During a ride you can only look.
- Feedback goes straight to the people who make Lactic. When the athlete is frustrated with Lactic itself (something broken, confusing or annoying in the app) or asks for something it can't do, help first, then call suggest_feedback once with a short summary and mention the button in a few words. Only about the app: frustration with training, a ride, the weather or their legs ("I couldn't hold my intervals today") is coaching, not feedback. Don't offer it for a question the app answers, and offer it at most once in a conversation.
- When they tell you something lasting about themselves (an injury, a preference, a constraint, how they respond to training), save it with remember, and forget facts that stop being true. Don't save numbers the app already tracks. They can see and edit what you save.

${APP_GUIDE}`;

const BRIEF = `You are the cycling coach inside Lactic, a training app for one athlete. Write this morning's brief, which they read on the Today page before deciding how to ride. It's written as soon as they open the page and again when last night's recovery, a weigh-in or their check-in (how they feel) arrives, so any of these may not be in yet.

${RULES}
- Look before you write: get_plan from two weeks ago shows what was ridden, the check-ins and how sessions felt; also check upcoming events. Use get_recovery, get_body or get_fitness when something stands out.
- recentRideFeedback in the status is what they said after recent rides: too easy, about right, too hard or couldn't finish, effort (RPE 1-10) and a note. The engine already moves their levels from it, so a single answer needs no change; mention it when it matters, and act on a pattern (several too hard, or too easy, in a row).
- todayOptions.checkin is how they say they feel, whether they're ill, the time they have and their note. When they've checked in, start from it: it matters more than any number, and the brief answers it. If it's "Not yet", don't ask; the page asks under the brief.
- The brief is 3 to 6 sentences, no list: how recovered and fresh they are, today's weigh-in if there is one (the trend only when it matters for training), today's session and whether it suits them, and how recent training and the weeks ahead look against their goals. If recovery or the weigh-in isn't in yet, say so in a few words and don't speculate about it. Recovery is in when recoveryToday is set, even while there's no score yet; then use its HRV, resting heart rate and sleep. When recoverySignals lists anything (a run of low HRV nights, signs of getting ill, sleep debt), say it plainly: it outweighs a single good score, and the engine's todayOptions already account for it. exertionToday is today's load so far against today's target from recovery; mention it when the planned ride would land well outside the target. Quote form, fatigue and fitness exactly as the status gives them: Today shows the same numbers.
- You choose each key day's workout once a week; whyThisWorkout on a day is your reason. Say in a few words what today's session is for.
- Then propose changes, only where the data gives a reason:
  - Today: todayOptions in the status is what today could be (as planned, harder, easier, shorter, endurance, recovery, rest), built by the engine from recovery, form, recent rides and the athlete's check-in. Call suggest_today once with the option that suits them; the athlete chooses under the brief. The engine's recommended option is a sound default: pick another only for a reason in the data or their note, and say why. Don't use propose_day_change for today. When todayOptions is null, today is settled (chosen, ridden, a race, or riding outside): leave it alone.
  - The plan ahead: at most two changes, from what you saw. Sessions that felt too hard or too easy, missed days, several poor nights in a row, or a forecast that's off for an event. Use get_day_options with propose_day_change, propose_swap, get_workouts with propose_workout when a different structure would suit the athlete or their event better, or propose_availability for a lasting change to weekly hours or ramp rate.
  - Often the right answer is no change. Never propose something just to have a proposal.
- Mention each proposal in the brief in a few words. The athlete accepts or dismisses each one with a button under it.
- On a race day (raceToday in the status), the brief is the race plan instead, 4 to 7 sentences: readiness in one line, then pacing and tactics for this kind of race, using their power numbers from get_power and FTP (for cyclocross: the start, the first lap, recovering on the straights, and run-ups; for a time trial or hill climb: target watts and not starting too hard; for long events: holding back early). Don't repeat the warm-up, timeline or fuelling, which the Today page already shows from raceToday. Don't propose changes to today; a change to the days after the race is fine if recovery calls for it.`;

const MAX_TURNS = 8;
/** Earlier messages sent with each new one, at most; older ones are folded into the summary. */
export const HISTORY_MESSAGES = 40;
/** Messages kept verbatim after summarizing. */
export const KEEP_MESSAGES = 20;

/** The system message: instructions, what the coach remembers, the summary of older conversation, the status, and the page the athlete is on. */
function system(instructions: string, data: CoachData, summary: string, page?: string | null) {
  const parts = [instructions, personaPrompt(data.persona ?? DEFAULT_PERSONA)];
  parts.push(
    data.memory.length
      ? `What you remember about the athlete (id: fact):\n${data.memory.map((m) => `${m.id}: ${m.fact}`).join("\n")}`
      : "You haven't saved anything about the athlete yet.",
  );
  if (summary.trim()) parts.push(`Summary of your earlier conversation:\n${summary.trim()}`);
  parts.push(`Status (from the engine):\n${JSON.stringify(status(data))}`);
  if (page) parts.push(page);
  return parts.join("\n\n");
}

/** Answers the latest user message in `history`. `page` describes the page they're on (page-context.ts). */
export async function coachChat(complete: Complete, data: CoachData, history: ChatTurn[], summary = "", hooks: ChatHooks = {}, page?: string | null): Promise<ChatReply> {
  const messages: ChatMessage[] = [
    { role: "system", content: system(CHAT, data, summary, page) },
    ...turnsForModel(history.slice(-HISTORY_MESSAGES)).map((m) => ({ role: m.role, content: m.content })),
  ];
  // Feedback is offered once a conversation: after that the tool isn't there to call.
  const feedback = feedbackOffered(history) ? [] : FEEDBACK_TOOLS;
  return run(complete, data, messages, [...forFeatures(TOOLS, data.features), ...MEMORY_TOOLS, ...feedback, ...(appTools()?.tools ?? [])], hooks);
}

/** True when a reply in `history` already offered to send feedback. */
export function feedbackOffered(history: ChatTurn[]) {
  return history.some((m) => m.role === "assistant" && Boolean(m.meta?.feedback));
}

/** This morning's brief, from the status, the tools and the recent conversation, with any plan changes it proposes. */
export async function morningBrief(complete: Complete, data: CoachData, history: ChatTurn[], summary = "", hooks: ChatHooks = {}): Promise<ChatReply> {
  const messages: ChatMessage[] = [
    { role: "system", content: system(BRIEF, data, summary) },
    ...turnsForModel(history.slice(-6)).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: "Write today's morning brief." },
  ];
  return run(complete, data, messages, [...forFeatures(TOOLS, data.features), ...TODAY_TOOLS], hooks);
}

const PLAN_WEEK = `You are the cycling coach inside Lactic, a training app for one athlete. Choose the workout for each key day listed below, so every session has a purpose.

${RULES}
- The engine has set each key day's zone, level and length from the plan, and it owns the load: keep them. You choose the workout structure within the zone, and its targets when there's a reason, or a fixed workout (Lactic's library or the athlete's own) that fits the day. Favorites are workouts the athlete liked: when one fits a day and suits it, prefer it, but keep variety and progression. Days already holding a favorite aren't listed; leave them.
- Look first: get_events for what's coming, get_plan from three weeks ago for what was ridden, which structures and how they felt (afterRide), and get_power when it helps.
- Read recovery too: recoverySignals in the status and get_recovery for the last two weeks. When the athlete is run down (a run of low HRV or high resting heart rate, signs of illness, sleep debt, recovery scores under 45 most days), keep the zone but choose a less demanding structure (steadier, fewer and shorter efforts) for the first key days and say so in the reason. When recovery is good and steady, you can progress. get_workouts lists the structures with what each trains and their targets at the athlete's level.
- Build with intent: what the next important event demands, the athlete's weaknesses and what they've told you, and progression from recent weeks. Get more race-like as an event nears. Vary structures, but repeat one on purpose when it's a progression. Set targets only for a reason (a race's demands, how recent sessions felt); otherwise the level sets them.
- Call pick_workout once for every listed day. The reason is one sentence to the athlete about why this workout on this day.
- Then reply with 2 to 4 plain sentences on the intent of the days ahead. No list.
- When the message also has last week's review (from the engine), your reply is instead the weekly review, which the athlete reads on Today at the start of the week: 4 to 6 plain sentences, no list. How last week went against the plan (planned and done stress, days done, partly done, moved or missed), how the sessions felt from their answers, what the levels that moved mean, and what this week is for (its phase and the key days you picked) toward the next event. Quote the review's numbers exactly; the card under your words shows them too.`;

/** The weekly planning run: a workout for each of `days` (key days in the plan), with reasons, and the review of last week when given. */
export async function planWeek(complete: Complete, data: CoachData, days: PlanDay[], summary = "", hooks: ChatHooks = {}, review?: WeekReview | null): Promise<ChatReply> {
  const list = days.length ? `Key days to plan:\n${days.map((d) => `${d.date}: ${describeDay(d)}`).join("\n")}` : "No key days to plan this time; don't call pick_workout.";
  const messages: ChatMessage[] = [
    { role: "system", content: system(PLAN_WEEK, data, summary) },
    { role: "user", content: review ? `${list}\n\nLast week's review:\n${JSON.stringify(reviewSummary(review))}` : list },
  ];
  const tools = [...forFeatures(TOOLS, data.features).filter((t) => READ_TOOL_NAMES.includes(t.function.name)), ...PICK_TOOLS];
  return run(complete, data, messages, tools, hooks, Math.max(MAX_TURNS, days.length + 6));
}

const RACE_DEBRIEF = `You are the cycling coach inside Lactic, a training app for one athlete. Write their post-race debrief, which they read on the race's report page under the charts.

${RULES}
- The race report below is from the engine: lap times, the gap to the rider compared, seconds lost or gained by kind of section (corners, straights, climbs, descents, slow spots such as barriers, sand and run-ups), the stretches of the lap where time went, one-off losses, ranks in the field, and the engine's own advice. Quote its numbers exactly and name its sections ("Corner 7", "Climb 6") and laps, which the page shows on a map.
- Other riders' files often have no power or heart rate, and some no times at all; the report says how the compared rider's times were found and how sure its section times are (howSureSectionTimesAre). Lap times and gaps at the line are exact when they come from results; below "high", call section times estimates, give whole seconds rather than tenths, and lean on patterns that repeat lap after lap. When it's "low", say the sections are rough and suggest getting the rider's original file.
- Their own words come first: the race notes and post-ride answer explain what the numbers show (a crash, a bad line, a mechanical, a slow start). Connect them.
- Use get_events for their next race and get_power or get_fitness when it helps the training suggestion. Don't propose plan changes here.
- Write it like a coach's debrief: one short paragraph on how the race went (result, gap, its shape from the laps); one on where the time went and why, biggest first; then "Next race:" and three numbered priorities, each specific and doable and tied to a number from the report; then one or two sentences on what to train in the coming weeks, which they can ask you to add to the plan. 180 to 300 words. This message may use that numbered list.`;

const SOLO_DEBRIEF = `You are the cycling coach inside Lactic, a training app for one athlete. Write their post-race debrief for a long race that isn't laps (a point-to-point road race, gran fondo or gravel race), which they read on the race's report page under the charts.

${RULES}
- The race report below is from the engine, read from the rider's own file: the course cut into climbs, descents and the roads between, with time, power, %FTP, heart rate and the work already done (kJ) arriving at each; pacing by quarter of riding time; heart-rate drift; durability (best 5 and 20 minutes in each 1,000 kJ of work against their fresh best); stops and the stretches between them; and, when there are any, their own past editions or other riders lined up along the route. Quote its numbers exactly and name its sections and places as it does.
- There may be nobody to compare with. Then the race is read against the rider: how they paced it, where they faded and why, how the climbs held up in order, what stops cost, and what the stretches between stops asked of their fueling. Don't invent other riders' numbers.
- Their own words come first: the race notes and post-ride answer explain what the numbers show (cramps, heat, gut trouble, a crash, a group they rode with). Connect them; fade with falling heart rate and big drift often goes with fueling, heat or under-training, which their notes may confirm.
- Use get_events for their next race and get_power or get_fitness when it helps the training suggestion. Don't propose plan changes here.
- Write it like a coach's debrief: one short paragraph on how the day went (time, its shape from the quarters and the climbs); one on where it was won or lost and why, biggest first; then "Next time:" and three numbered priorities (pacing, fueling and stops, and the training that fixes the fade), each specific and tied to a number from the report; then one or two sentences on what to train in the coming weeks, which they can ask you to add to the plan. 180 to 320 words. This message may use that numbered list.`;

/** A debrief of a race that isn't laps, from the engine's solo report (engine/race/solo-brief.ts). */
export async function soloRaceDebrief(complete: Complete, data: CoachData, report: unknown, notes: string, summary = "", hooks: ChatHooks = {}): Promise<ChatReply> {
  const messages: ChatMessage[] = [
    { role: "system", content: system(SOLO_DEBRIEF, data, summary) },
    { role: "user", content: `Race report (from the engine):\n${JSON.stringify(report)}\n\nWhat I said about the race:\n${notes.trim() || "(nothing yet)"}\n\nWrite my race debrief.` },
  ];
  const tools = forFeatures(TOOLS, data.features).filter((t) => READ_TOOL_NAMES.includes(t.function.name));
  return run(complete, data, messages, tools, hooks);
}

/** A post-race debrief from the engine's race report (`report`, from engine/race/brief.ts) and what the athlete said. */
export async function raceDebrief(complete: Complete, data: CoachData, report: unknown, notes: string, summary = "", hooks: ChatHooks = {}): Promise<ChatReply> {
  const messages: ChatMessage[] = [
    { role: "system", content: system(RACE_DEBRIEF, data, summary) },
    { role: "user", content: `Race report (from the engine):\n${JSON.stringify(report)}\n\nWhat I said about the race:\n${notes.trim() || "(nothing yet)"}\n\nWrite my race debrief.` },
  ];
  const tools = forFeatures(TOOLS, data.features).filter((t) => READ_TOOL_NAMES.includes(t.function.name));
  return run(complete, data, messages, tools, hooks);
}

/** The review as the coach reads it: labelled, with hours rather than seconds. */
export function reviewSummary(r: WeekReview) {
  return {
    week: `${r.start} to ${r.end}`,
    plannedStress: r.planned,
    doneStress: r.done,
    rides: r.rides,
    hours: Math.round((r.seconds / 3600) * 10) / 10,
    days: r.marks,
    howSessionsFelt: Object.fromEntries(Object.entries(r.felt).filter(([, n]) => n > 0).map(([d, n]) => [DIFFICULTY_LABELS[d as keyof typeof DIFFICULTY_LABELS], n])),
    averageRpe: r.rpe,
    levelsMoved: r.levels.map((l) => ({ zone: ZONE_LABELS[l.zone], from: l.from, to: l.to })),
    fitnessAtEnd: r.fitness,
    fitnessChange: r.fitnessChange,
    formAtEnd: r.form,
  };
}

/** What today's brief was written with. */
export interface BriefInputs {
  recovery: boolean;
  weighed: boolean;
  /** Form coming into today, rounded. */
  form: number;
  /** What today is: the event, the session to ride, or rest. */
  session: string;
  /** When you last said how you feel today. */
  checkin: string | null;
}

/** What the brief was written from, so Today and the brief can't drift apart. */
export function briefInputs(state: CoachData["state"], weighed: boolean): BriefInputs {
  const chosen = state.todayStored?.chosen;
  const day = state.todayPlan;
  const session = chosen
    ? (chosen.session?.workout.name ?? "rest")
    : day?.role === "event" && day.goal
      ? `event:${day.goal.id}`
      : (day?.session?.workout.name ?? "rest");
  return { recovery: Boolean(state.recovery?.today), weighed, form: Math.round(state.form), session, checkin: state.todayStored?.checkin?.at ?? null };
}

/** Form moves a little with every ride; only a real change is worth a new brief. */
const FORM_CHANGE = 3;

/**
 * True when there's no brief for today yet, or something it was written from has changed since:
 * recovery or a weigh-in arrived, rides synced and moved your form, or today's session changed.
 * A brief whose proposals you've applied or dismissed stays as it is, unless you've checked in since.
 */
export function briefStale(existing: StoredMessage | null, inputs: BriefInputs) {
  if (!existing) return true;
  const meta = existing.meta as Partial<BriefInputs>;
  if ((meta.checkin ?? null) !== inputs.checkin) return true;
  if (existing.proposals.some((p) => p.status !== "pending")) return false;
  return (
    (inputs.recovery && !meta.recovery) ||
    (inputs.weighed && !meta.weighed) ||
    typeof meta.form !== "number" ||
    Math.abs(meta.form - inputs.form) >= FORM_CHANGE ||
    meta.session !== inputs.session
  );
}

async function run(complete: Complete, data: CoachData, messages: ChatMessage[], tools: unknown[], hooks: ChatHooks, maxTurns = MAX_TURNS): Promise<ChatReply> {
  const proposals: Proposal[] = [];
  const memory: MemoryOp[] = [];
  const picks: WorkoutPick[] = [];
  let today: OptionId | undefined;
  let feedback: FeedbackDraft | undefined;
  const allowed = new Set((tools as { function: { name: string } }[]).map((t) => t.function.name));

  for (let turn = 0; turn < maxTurns; turn++) {
    hooks.onTurn?.();
    const reply = await complete(messages, turn === maxTurns - 1 ? [] : tools, hooks.onText);
    messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });
    if (!reply.tool_calls?.length) {
      const message = (reply.content ?? "").trim();
      if (message) return { message, proposals, memory, picks, today, ...(feedback ? { feedback } : {}) };
      messages.push({ role: "user", content: "Please answer in a message." });
      continue;
    }
    for (const call of reply.tool_calls) {
      const name = call.function.name;
      const app = appTools();
      const isApp = Boolean(app?.tools.some((t) => t.function.name === name));
      hooks.onStatus?.(STATUS[name] ?? (isApp ? app!.status[name] : undefined) ?? "Thinking");
      const args = parseArgs(call.function.arguments);
      const result = !allowed.has(name) ? { content: `Unknown tool ${name}` } : isApp ? await app!.run(name, args) : runTool(data, name, args);
      if (result.proposal && !proposals.some((p) => JSON.stringify(p.change) === JSON.stringify(result.proposal!.change))) proposals.push(result.proposal);
      if (result.memory) memory.push(result.memory);
      if (result.today) today = result.today;
      if (result.feedback && !feedback) feedback = result.feedback;
      if (result.pick) picks.splice(0, picks.length, ...picks.filter((p) => p.date !== result.pick!.date), result.pick);
      messages.push({ role: "tool", tool_call_id: call.id, content: result.content });
    }
  }
  if (proposals.length) return { message: "Here's what I'd change.", proposals, memory, picks, today, ...(feedback ? { feedback } : {}) };
  if (feedback) return { message: "You can send this to the Lactic team with the button below.", proposals, memory, picks, feedback };
  if (picks.length) return { message: "I've picked the workouts for the key days ahead.", proposals, memory, picks };
  throw new Error("The coach didn't finish its answer");
}

const SUMMARIZE = `You keep a running summary of a coach's chat with their cyclist athlete, so the coach remembers older conversation. Update the summary with the new messages. Keep what matters for coaching later: questions asked, advice given, plan changes proposed or applied, how check-ins went, how the athlete felt, decisions and open threads. Drop small talk and numbers the app tracks anyway (rides, fitness, recovery). Plain prose, at most 250 words, oldest first. Reply with the summary only.`;

/** Folds older messages into the running summary. */
export async function summarize(complete: Complete, previous: string, messages: (ChatTurn & { kind?: string; createdAt?: string })[]): Promise<string> {
  const transcript = messages.map((m) => `${m.createdAt ? `[${m.createdAt.slice(0, 10)}] ` : ""}${m.kind && m.kind !== "chat" ? `(${m.kind}) ` : ""}${m.role === "user" ? "Athlete" : "Coach"}: ${m.content}${attachmentNames(m.attachments)}`).join("\n\n");
  const reply = await complete(
    [
      { role: "system", content: SUMMARIZE },
      { role: "user", content: `Current summary:\n${previous.trim() || "(none yet)"}\n\nNew messages:\n${transcript}` },
    ],
    [],
  );
  const summary = (reply.content ?? "").trim();
  if (!summary) throw new Error("The summary came back empty");
  return summary.slice(0, 8000);
}

const STATUS: Record<string, string> = {
  get_rides: "Looking at your rides",
  get_ride: "Looking at a ride",
  get_fitness: "Checking fitness and form",
  get_plan: "Reading the plan",
  get_events: "Checking your events",
  get_recovery: "Checking recovery",
  get_body: "Checking weigh-ins",
  get_power: "Looking at your power",
  get_athlete: "Reading your settings",
  get_day_options: "Asking the engine for options",
  propose_day_change: "Drafting a change",
  get_workouts: "Looking through workouts",
  propose_workout: "Building a workout",
  propose_swap: "Drafting a change",
  propose_reset_day: "Drafting a change",
  propose_availability: "Trying new hours on the plan",
  propose_break: "Planning around a break",
  pick_workout: "Picking a workout",
  remember: "Making a note",
  suggest_feedback: "Writing up feedback",
  forget: "Updating notes",
};

function parseArgs(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** A conversation's title: the start of its first message, on one line. */
export function titleFrom(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}
