// The demo's coach: an OpenAI-style /chat/completions served in the page (see setup.ts), so the
// real chat, proposal cards and brief run without an AI account. Replies are scripted; the one
// change it proposes (a weekend swap) goes through the coach's real propose_swap tool, so the card
// and Apply are the app's own.

interface Msg {
  role: string;
  content: string | null;
  tool_calls?: unknown[];
}
interface Body {
  messages: Msg[];
  tools?: { function: { name: string } }[];
  stream?: boolean;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The coming Saturday and Sunday (next week's when today is already the weekend). */
export function weekend(now = new Date()): [string, string] {
  const sat = new Date(now);
  const ahead = (6 - now.getDay() + 7) % 7 || 7;
  sat.setDate(now.getDate() + (now.getDay() === 0 ? 6 : ahead));
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return [iso(sat), iso(sun)];
}

const INTRO =
  "This is the demo, so my replies are scripted. With your own AI connected, I read your plan, rides and recovery and answer anything about your training. Try asking me to move Saturday's ride to Sunday.";

const BRIEF =
  "Your morning is in: recovery and sleep. Pick today's session below, ride it on the trainer or take it outside, and keep each interval steady on target. Ask me anything about it.";

const PLAN =
  "This week keeps building toward a higher FTP: one sustained threshold-style session, one shorter, harder day, and an easy long ride at the weekend. The rest days are there so the hard days land well.";

type Reply = { content: string } | { call: { name: string; arguments: Record<string, unknown> } };

export function reply(body: Body): Reply {
  const messages = body.messages ?? [];
  const last = messages[messages.length - 1];
  const tools = new Set((body.tools ?? []).map((t) => t.function.name));
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (last?.role === "tool") {
    if (/error|couldn|can't|not /i.test(last.content ?? "") && !/"ok"\s*:\s*true/.test(last.content ?? ""))
      return { content: "I couldn't set that swap up here. In the full app I'd look at the plan and suggest another way to fit it in." };
    return { content: "Here's the swap. Apply it and both days move in your plan, or Dismiss to keep things as they are." };
  }
  if (/^Write today's morning brief/i.test(lastUser)) return { content: BRIEF };
  if (/^(Key days to plan|No key days)/.test(lastUser)) return { content: PLAN };
  if (!tools.has("propose_swap")) return { content: "A demo conversation about training." };
  if (/\b(move|swap|switch|shift|busy|can't make|cannot make|saturday|sunday|weekend)\b/i.test(lastUser)) {
    const [sat, sun] = weekend();
    return {
      call: {
        name: "propose_swap",
        arguments: { date: sat, other_date: sun, reason: "Your two weekend sessions trade places, so Saturday's ride moves to Sunday." },
      },
    };
  }
  if (/\b(tired|wrecked|sore|sick|easier|rest)\b/i.test(lastUser))
    return { content: "On a tired day I'd swap today's session for an easier version or a rest day, then show you the change to apply. In this demo I can only move weekend rides, so try asking me to move Saturday's ride." };
  return { content: INTRO };
}

const encoder = new TextEncoder();

function sse(r: Reply): ReadableStream<Uint8Array> {
  const chunks: string[] = [];
  const event = (delta: unknown, finish: string | null = null) => chunks.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  if ("content" in r) {
    // A few words at a time, like a real model.
    for (const piece of r.content.match(/\S+\s*/g) ?? []) event({ content: piece });
    event({}, "stop");
  } else {
    event({ tool_calls: [{ index: 0, id: "call_demo", type: "function", function: { name: r.call.name, arguments: JSON.stringify(r.call.arguments) } }] });
    event({}, "tool_calls");
  }
  chunks.push("data: [DONE]\n\n");
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) return controller.close();
      await new Promise((r) => setTimeout(r, i === 0 ? 450 : 28));
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as Body;
  const r = reply(body);
  if (body.stream) return new Response(sse(r), { headers: { "content-type": "text/event-stream" } });
  await new Promise((done) => setTimeout(done, 400));
  const message =
    "content" in r
      ? { role: "assistant", content: r.content }
      : { role: "assistant", content: null, tool_calls: [{ id: "call_demo", type: "function", function: { name: r.call.name, arguments: JSON.stringify(r.call.arguments) } }] };
  return Response.json({ choices: [{ index: 0, message, finish_reason: "content" in r ? "stop" : "tool_calls" }], usage: { prompt_tokens: 0, completion_tokens: 0 } });
}
