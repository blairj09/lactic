// The built-in coach's web search (search_web), for things that change: gear, prices, new products,
// event dates. Only the search words leave Lactic: the coach writes a short query, and it goes to
// OpenRouter's web plugin in a call of its own, with no status, rides, health data or conversation.
// The result is a short summary with its sources, which the chat shows as links under the reply.
// Counted in ai_usage like any other call, so the monthly limit covers it.

import { cleanSources, type Source } from "@/lib/coach/sources";
import { checkBudget, record, target } from "./client";
import { coachSetup, webSearchOn, type CoachSetup } from "./settings";

/** Results the search reads. OpenRouter's Exa engine charges $0.007 a request for up to 10 results (checked November 2026). */
export const SEARCH_RESULTS = 5;
export const SEARCH_FEE_USD = 0.007;
export const MAX_QUERY = 200;

const SEARCHER = `You answer one web search query for a cycling coach, using the search results. Give the facts that answer it: product names, current prices with currency, dates, specs and what reviewers say, noting when sources disagree or a result looks old. At most 200 words, plain text. If the results don't answer it, say so.`;

/** Checks the query the coach wrote, or throws with what's wrong. */
export function checkQuery(raw: unknown): string {
  const query = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!query) throw new Error("Give the search words in query");
  if (query.length > MAX_QUERY) throw new Error(`Keep the query under ${MAX_QUERY} characters: short search words, not a question with your athlete's details`);
  return query;
}

/** The sources in an OpenRouter reply: its url_citation annotations. */
export function citations(message: unknown): Source[] {
  const annotations = (message as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(annotations)) return [];
  return cleanSources(
    annotations
      .filter((a) => a && typeof a === "object" && (a as { type?: unknown }).type === "url_citation")
      .map((a) => (a as { url_citation?: unknown }).url_citation),
  );
}

export interface SearchResult {
  query: string;
  answer: string;
  sources: Source[];
}

/** Runs one search. Throws when web search is off, the budget is spent or the provider fails. */
export async function searchWeb(rawQuery: unknown, given?: CoachSetup): Promise<SearchResult> {
  const query = checkQuery(rawQuery);
  const setup = given ?? (await coachSetup());
  if (!webSearchOn(setup) || !setup.chat) throw new Error("Web search is off. It can be turned on in Settings → Coach (needs an OpenRouter key).");
  const t = target(setup);
  await checkBudget(setup, t);
  const payload = JSON.stringify({
    model: setup.chat.model,
    messages: [
      { role: "system", content: SEARCHER },
      { role: "user", content: query },
    ],
    plugins: [{ id: "web", engine: "exa", max_results: SEARCH_RESULTS }],
    temperature: 0.2,
    max_tokens: 700,
    usage: { include: true },
  });
  const response = await fetch(t.url, { method: "POST", headers: t.headers, body: payload, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`The search failed (${response.status}): ${(await response.text()).slice(0, 160)}`);
  const json = await response.json();
  const message = json?.choices?.[0]?.message;
  const answer = typeof message?.content === "string" ? message.content.trim() : "";
  if (!answer) throw new Error("The search came back empty");
  const usage = json?.usage ?? {};
  await record("web_search", t, setup.chat, usage.prompt_tokens ?? Math.ceil(payload.length / 4), usage.completion_tokens ?? Math.ceil(answer.length / 4), {
    fees: SEARCH_FEE_USD,
    billed: typeof usage.cost === "number" ? usage.cost : undefined,
  });
  return { query, answer, sources: citations(message) };
}

// Whether the coach is offered search_web right now. The tool list is read synchronously while a chat
// runs, so applyEnv (boot and every coach settings save) keeps this in step with the settings.
let offered = false;
export const webSearchOffered = () => offered;
export function offerWebSearch(on: boolean) {
  offered = on;
}
