# Coach evals

How well does a model coach inside Lactic? These evals run realistic messages from a rider through
the built-in coach's own code (the chat, the morning brief and the weekly planning run, with every
tool and the engine behind them) against any model, and score each answer two ways:

- **Scripted checks**: did it call the right tools, propose the right kind of change (a break from
  Nov 9 to 13, the trainer as power source...), stay within what the coach may do (only look during a
  ride, never ask for a key), suggest a sensible option for today, and quote only numbers that were
  in the data? Every answer also gets the grounding check and a limit on failing tool calls.
- **A judge model** (optional): reads the status, the tool calls and results, the proposals and the
  reply, and scores coaching, grounding, safety, app rules and communication from 1 to 5 against the
  scenario's rubric, with a pass or fail.

A run passes when its checks pass and, with a judge, the judge passes it. Critical scenarios (safety,
keys, hidden instructions, invented numbers) are reported apart: a model that fails them shouldn't be
recommended whatever its overall score.

## Scenarios

37 scenarios in six groups (`npm run eval:coach -- --list`):

| Group | What it covers |
|---|---|
| Plan changes | travel breaks, a missed day, short on time, new weekly hours, adding an event, asking for more |
| Recovery advice | poor and good recovery, no score while the baseline builds, a tired trend, morning briefs |
| Rule-based workouts | asked to write or invent a workout, raise FTP, the weekly workout picks |
| App troubleshooting | ERG with Zwift open, intervals.icu key rejected, HR drops mid-ride, a dying power meter, new gear |
| Safety | chest pain, training through a fever, overreaching, crash diets, a sick check-in, sore knees, instructions hidden in a ride note, asking for an API key |
| Tool use and grounding | last ride, W/kg, fitness trend, race readiness, weight, remembering and forgetting, data that doesn't exist |

The athlete (`athlete.ts`) is built with the real engine: eight weeks of rides, the fitness series
from them, the plan toward an A gravel race on Dec 12, recovery, weigh-ins and post-ride answers.
Today is Thursday 2026-10-29. Each scenario changes only what it's about. App troubleshooting runs
against a scripted desktop shell (`app.ts`) that follows the real tools' rules.

To see exactly what the coach is sent for a scenario: `npm run eval:coach -- --show app-erg-zwift`.

## Running

From `app/`, with the provider's key in the environment (never in a file in the repo):

```sh
OPENROUTER_API_KEY=sk-or-... ANTHROPIC_API_KEY=sk-ant-... \
  npm run eval:coach -- \
  --models openrouter:anthropic/claude-haiku-5.5,openrouter:z-ai/glm-5.3,openrouter:moonshotai/kimi-k2.6,openrouter:deepseek/deepseek-v4.1-flash \
  --judge anthropic:claude-sonnet-5-5
```

Models are `provider:model` with the providers Lactic offers: `openrouter`, `anthropic`, `openai`,
`google`, `ollama`, `lmstudio`, `custom` (set `EVAL_BASE_URL`). Keys: `OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `EVAL_API_KEY` (custom). Local models
need no key: `--models ollama:qwen3:8b,ollama:qwen3:14b,ollama:gpt-oss:20b`. Calls use the app's own
settings (`src/ai/sampling.ts`), and costs use the provider's reported cost or the list prices in
`src/ai/providers.ts`. The suggested models and `docs/coach-models.md` should follow these results.

| Option | |
|---|---|
| `--models a,b` | models to test |
| `--judge m` | the judge model; leave out for scripted checks only. Use a strong model that isn't under test |
| `--only x,y` | scenario ids, id prefixes (`safety-`) or groups (`troubleshooting`) |
| `--repeat n` | run each scenario n times to see how steady a model is |
| `--max-cost d` | stop starting runs once spend reaches $d (default 1). Counted from the provider's reported cost or Lactic's list prices (`src/ai/providers.ts`); local models are free |
| `--concurrency n` | runs at once (default 3, or 1 when every model is local) |
| `--out dir` | where results go (default `evals/results/<time>/`, not committed) |

### On GitHub Actions

Actions → **Coach evals** → Run workflow runs the same command on a GitHub runner, with the models,
judge, scenarios and spend cap as inputs (defaults: the OpenRouter suggestions, a Sonnet judge, $3).
Keys come from repository secrets (`OPENROUTER_API_KEY`, and `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY` for those providers). The summary shows on the run page and the full results are
the `coach-evals` artifact. It never runs on its own, since it spends API credit.

Each run writes `results.json` (every transcript, check and verdict, plus a per-model summary for
model recommendations) and `summary.md` (tables by model, group and scenario, and every failure).

**Cost.** One scenario is about 5k tokens per model call and usually 2 to 4 calls, so a full pass is
roughly 0.5 to 1M input tokens per model: cents for Haiku 5.5, GLM or DeepSeek Flash, under a dollar
for Kimi K2.6, a dollar or two for Sonnet-class models. A Sonnet judge adds about $0.30 per model.
Start with `--only` and the default `--max-cost 1`.

## Adding a scenario

Copy a neighbour in `scenarios.ts`: a message, the athlete (`athlete({...})` with what's different),
the app state for troubleshooting, checks from `checks.ts`, and a rubric saying what a great answer
does. Run `npm test` (the tests run every scenario through the coach with a stand-in model) and
`--show` it to read what the coach sees. Keep checks to what any good answer must do; leave taste
to the judge.
