// npm run eval:coach -- --models openrouter:moonshotai/kimi-k2,anthropic:claude-haiku-4-5 --judge anthropic:claude-sonnet-4-5
// See evals/README.md for every option.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { judge } from "./judge";
import { addUsage, completer, emptyUsage, parseModel, priceOf, type ModelSpec, type Usage } from "./models";
import { markdown, summarize } from "./report";
import { score, transcribe } from "./run";
import { SCENARIOS } from "./scenarios";
import { CATEGORIES, type RunResult, type Scenario } from "./types";

function args(argv: string[]) {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [key, inline] = a.slice(2).split("=", 2);
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

/** Scenarios by id, id prefix or category, comma-separated. */
export function select(filter: string | undefined): Scenario[] {
  if (!filter) return SCENARIOS;
  const parts = filter.split(",").map((s) => s.trim()).filter(Boolean);
  return SCENARIOS.filter((s) => parts.some((p) => s.id === p || s.id.startsWith(p) || s.category === p));
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  }));
}

async function main() {
  const a = args(process.argv.slice(2));
  const scenarios = select(typeof a.only === "string" ? a.only : undefined);

  if (a.list) {
    for (const s of scenarios) console.log(`${s.id.padEnd(26)} ${CATEGORIES[s.category].padEnd(22)} ${s.critical ? "critical " : "         "}${s.title}`);
    return;
  }
  if (typeof a.show === "string") {
    const s = SCENARIOS.find((x) => x.id === a.show);
    if (!s) throw new Error(`No scenario ${a.show}`);
    // A stand-in model that answers at once shows the first prompt the coach would send.
    let first = "";
    await transcribe(async (messages) => {
      first ||= messages.map((m) => `--- ${m.role} ---\n${m.content}`).join("\n\n");
      return { role: "assistant", content: "(shown)" };
    }, s);
    console.log(first);
    return;
  }
  if (typeof a.models !== "string") {
    console.error("Give --models provider:model[,provider:model...] (or --list, --show <id>). See evals/README.md.");
    process.exitCode = 1;
    return;
  }

  const models = a.models.split(",").map((m) => parseModel(m.trim()));
  const judgeSpec = typeof a.judge === "string" ? parseModel(a.judge) : null;
  const repeats = Math.max(1, Number(a.repeat) || 1);
  const maxCost = Number(a["max-cost"] ?? 1);
  const concurrency = Number(a.concurrency) || (models.every((m) => m.local) ? 1 : 3);
  for (const m of [...models, ...(judgeSpec ? [judgeSpec] : [])]) {
    if (priceOf(m, 1, 1) === null && m.provider !== "openrouter") console.warn(`No price for ${m.id}: cost shows as unknown and the --max-cost guard can't count it.`);
  }
  if (judgeSpec && models.some((m) => m.id === judgeSpec.id)) console.warn(`The judge (${judgeSpec.id}) is also under test; it may favour its own answers.`);

  const spent = emptyUsage();
  const results: RunResult[] = [];
  const jobs = models.flatMap((m) => scenarios.flatMap((s) => Array.from({ length: repeats }, (_, repeat) => ({ m, s, repeat }))));
  let skipped = 0;
  console.log(`${jobs.length} runs: ${scenarios.length} scenarios × ${models.length} models × ${repeats}. Spend cap $${maxCost.toFixed(2)}.`);

  await pool(jobs, concurrency, async ({ m, s, repeat }: { m: ModelSpec; s: Scenario; repeat: number }) => {
    if (spent.cost !== null && spent.cost >= maxCost) {
      skipped++;
      return;
    }
    const usage: Usage = emptyUsage();
    const started = Date.now();
    const t = await transcribe(completer(m, usage), s);
    const seconds = (Date.now() - started) / 1000;
    const failures = score(s, t);
    let verdict: RunResult["judge"] = null;
    let judgeError: string | undefined;
    let judgeUsage: Usage | null = null;
    if (judgeSpec && !t.error) {
      judgeUsage = emptyUsage();
      try {
        verdict = await judge(completer(judgeSpec, judgeUsage, { maxTokens: 600, temperature: 0, json: true }), s, t);
      } catch (e) {
        judgeError = e instanceof Error ? e.message : String(e);
      }
    }
    addUsage(spent, usage);
    if (judgeUsage) addUsage(spent, judgeUsage);
    const checksPassed = failures.length === 0;
    const { context: _context, ...transcript } = t;
    const result: RunResult = {
      scenario: s.id,
      category: s.category,
      critical: Boolean(s.critical),
      model: m.id,
      repeat,
      failures,
      checksPassed,
      judge: verdict,
      judgeError,
      pass: checksPassed && (!judgeSpec || verdict?.pass === true),
      seconds,
      usage,
      judgeUsage,
      toolErrors: t.calls.filter((c) => c.result.startsWith("Error") || c.result.startsWith("Unknown tool")).length,
      transcript,
    };
    results.push(result);
    const mark = result.pass ? "✓" : "✗";
    console.log(`${mark} ${m.id} ${s.id}${repeats > 1 ? ` #${repeat + 1}` : ""} (${seconds.toFixed(1)}s)${result.pass ? "" : `: ${[...failures, ...(verdict && !verdict.pass ? [`judge: ${verdict.notes}`] : []), ...(judgeError ? [`judge error: ${judgeError}`] : [])].join("; ")}`}`);
  });

  const order = new Map(jobs.map((j, i) => [`${j.m.id}|${j.s.id}|${j.repeat}`, i]));
  results.sort((x, y) => order.get(`${x.model}|${x.scenario}|${x.repeat}`)! - order.get(`${y.model}|${y.scenario}|${y.repeat}`)!);
  const startedAt = new Date().toISOString();
  const dir = typeof a.out === "string" ? a.out : join("evals", "results", startedAt.replace(/[:.]/g, "-").slice(0, 19));
  mkdirSync(dir, { recursive: true });
  const meta = { started: startedAt, judge: judgeSpec?.id ?? null, repeats, scenarios: scenarios.map((s) => s.id), skipped, spent };
  writeFileSync(join(dir, "results.json"), JSON.stringify({ meta, summary: summarize(results), results }, null, 2));
  const md = markdown(results, meta);
  writeFileSync(join(dir, "summary.md"), md);
  console.log(`\n${md}`);
  if (skipped) console.log(`Stopped at the $${maxCost.toFixed(2)} cap: ${skipped} runs skipped. Raise --max-cost to run them.`);
  console.log(`Spent ${spent.cost === null ? "an unknown amount" : `$${spent.cost.toFixed(3)}`} (${spent.inputTokens} input, ${spent.outputTokens} output tokens). Results in ${dir}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
