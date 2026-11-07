// The coach drawer's data (GET), and one message to the coach, streamed back as events (POST, see stream.ts).

import { answer, coachModel, keepSummaryShort } from "@/lib/coach/conversation";
import { parseAttachments } from "@/lib/coach/attachments";
import { withLinks } from "@/lib/coach/attachments-server";
import { describePage } from "@/lib/coach/page-context";
import { currentConversation, listConversations, loadConversation, loadMessages, loadPersona, type Conversation } from "@/lib/coach/store";
import { createClient } from "@/lib/supabase/server";
import { eventStream } from "./stream";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MESSAGE = 4000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conversation (?conversation=id, else the current one), the list of conversations, and the coach's name, for the drawer. */
export async function GET(request: Request) {
  if (!coachModel()) return Response.json({ error: "The coach needs OPENROUTER_API_KEY" }, { status: 503 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("conversation");
  try {
    const conversation = asked && UUID.test(asked) ? await loadConversation(supabase, asked) : await currentConversation(supabase);
    const [messages, conversations, persona] = await Promise.all([
      loadMessages(supabase, conversation.id).then((m) => withLinks(supabase, m)),
      listConversations(supabase),
      loadPersona(supabase),
    ]);
    const brief = ({ id, title, createdAt, updatedAt }: Conversation) => ({ id, title, createdAt, updatedAt });
    return Response.json({ conversation: brief(conversation), messages, conversations: conversations.map(brief), name: persona.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Couldn't load that conversation" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  if (!coachModel()) return Response.json({ error: "The coach needs OPENROUTER_API_KEY" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const text = typeof body?.message === "string" ? body.message.trim() : "";
  const sentFiles = Array.isArray(body?.attachments) && body.attachments.length > 0;
  if ((!text && !sentFiles) || text.length > MAX_MESSAGE) return Response.json({ error: `Write a message of up to ${MAX_MESSAGE} characters` }, { status: 400 });
  // The page the drawer was opened on, so the coach knows what "this" is.
  const conversation = typeof body?.conversation === "string" && UUID.test(body.conversation) ? body.conversation : null;
  const page = typeof body?.page?.path === "string" ? describePage(body.page.path, typeof body.page.search === "string" ? body.page.search.slice(0, 500) : "") : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  // Files were uploaded to Storage from the browser; only paths in your own folder are read.
  const attachments = parseAttachments(body?.attachments, user.id);
  if (!text && !attachments.length) return Response.json({ error: "Those files can't be read" }, { status: 400 });
  return eventStream(
    (hooks) => answer(supabase, text, hooks, page, conversation, attachments),
    (saved) => (saved.conversationId ? keepSummaryShort(supabase, saved.conversationId) : Promise.resolve()),
  );
}
