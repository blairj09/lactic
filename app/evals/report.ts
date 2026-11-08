// Turns run results into a per-model summary (for model recommendations) and a Markdown report.

import { meanScore } from "./judge";
import { addUsage, emptyUsage, type Usage } from "./models";
import { CATEGORIES, type Category, type RunResult } from "./types";

export interface ModelSummary {
  model: string;
  runs: number;
  /** Share of runs that passed (checks, and the judge when it ran), 0 to 1. */
  passRate: number;
  checksPassRate: number;
  judgePassRate: number | null;
  /** Mean of the judge's five scores, 1 to 5. */
  judgeScore: number | null;
  /** Share of critical (safety-type) runs passed. */
  criticalPassRate: number;
  byCategory: Partial<Record<Category, number>>;
  medianSeconds: number;
  usage: Usage;
  /** Dollars per run (one chat message or brief), from usage; null when the price isn't known. */
  costPerRun: number | null;
  toolErrors: number;
  errors: number;
}

const share = (rs: RunResult[], f: (r: RunResult) => boolean) => (rs.length ? rs.filter(f).length / rs.length : 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

export function summarize(results: RunResult[]): ModelSummary[] {
  const models = [...new Set(results.map((r) => r.model))];
  return models
    .map((model) => {
      const rs = results.filter((r) => r.model === model);
      const judged = rs.filter((r) => r.judge);
      const usage = emptyUsage();
      for (const r of rs) addUsage(usage, r.usage);
      const byCategory: Partial<Record<Category, number>> = {};
      for (const cat of Object.keys(CATEGORIES) as Category[]) {
        const inCat = rs.filter((r) => r.category === cat);
        if (inCat.length) byCategory[cat] = share(inCat, (r) => r.pass);
      }
      const critical = rs.filter((r) => r.critical);
      return {
        model,
        runs: rs.length,
        passRate: share(rs, (r) => r.pass),
        checksPassRate: share(rs, (r) => r.checksPassed),
        judgePassRate: judged.length ? share(judged, (r) => r.judge!.pass) : null,
        judgeScore: judged.length ? judged.reduce((s, r) => s + meanScore(r.judge!), 0) / judged.length : null,
        criticalPassRate: share(critical, (r) => r.pass),
        byCategory,
        medianSeconds: median(rs.map((r) => r.seconds)),
        usage,
        costPerRun: usage.cost === null ? null : usage.cost / rs.length,
        toolErrors: rs.reduce((s, r) => s + r.toolErrors, 0),
        errors: rs.filter((r) => r.failures.some((f) => f.startsWith("error:"))).length,
      };
    })
    .sort((a, b) => b.passRate - a.passRate || (b.judgeScore ?? 0) - (a.judgeScore ?? 0));
}

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const money = (x: number | null) => (x === null ? "?" : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(3)}`);

export function markdown(results: RunResult[], meta: { started: string; judge: string | null; repeats: number }): string {
  const summary = summarize(results);
  const lines: string[] = [];
  lines.push(`# Coach evals, ${meta.started.slice(0, 16).replace("T", " ")} UTC`, "");
  lines.push(`${new Set(results.map((r) => r.scenario)).size} scenarios × ${summary.length} models × ${meta.repeats} repeat${meta.repeats === 1 ? "" : "s"}. Judge: ${meta.judge ?? "none (scripted checks only)"}.`, "");
  lines.push("A run passes when every scripted check passes and, with a judge, the judge passes it. Critical runs are the safety-type scenarios.", "");
  lines.push("| Model | Pass | Critical | Checks | Judge pass | Judge score | Median s | Cost per message | Tool errors |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of summary) {
    lines.push(`| ${s.model} | ${pct(s.passRate)} | ${pct(s.criticalPassRate)} | ${pct(s.checksPassRate)} | ${pct(s.judgePassRate)} | ${s.judgeScore === null ? "–" : s.judgeScore.toFixed(2)} | ${s.medianSeconds.toFixed(1)} | ${money(s.costPerRun)} | ${s.toolErrors} |`);
  }
  lines.push("", "## By category", "");
  const cats = (Object.keys(CATEGORIES) as Category[]).filter((c) => summary.some((s) => s.byCategory[c] !== undefined));
  lines.push(`| Model | ${cats.map((c) => CATEGORIES[c]).join(" | ")} |`, `|---|${cats.map(() => "---").join("|")}|`);
  for (const s of summary) lines.push(`| ${s.model} | ${cats.map((c) => pct(s.byCategory[c] ?? null)).join(" | ")} |`);

  lines.push("", "## Scenarios", "");
  const scenarios = [...new Set(results.map((r) => r.scenario))];
  lines.push(`| Scenario | ${summary.map((s) => s.model).join(" | ")} |`, `|---|${summary.map(() => "---").join("|")}|`);
  for (const id of scenarios) {
    const cells = summary.map((s) => {
      const rs = results.filter((r) => r.model === s.model && r.scenario === id);
      return rs.length ? `${rs.filter((r) => r.pass).length}/${rs.length}` : "–";
    });
    lines.push(`| ${id} | ${cells.join(" | ")} |`);
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    lines.push("", "## Failures", "");
    for (const r of failed) {
      const why = [...r.failures, ...(r.judge && !r.judge.pass ? [`judge: ${r.judge.notes}`] : []), ...(r.judgeError ? [`judge error: ${r.judgeError}`] : [])];
      lines.push(`- **${r.model}** · ${r.scenario}${meta.repeats > 1 ? ` #${r.repeat + 1}` : ""}: ${why.join("; ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
