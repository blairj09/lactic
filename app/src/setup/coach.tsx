// Your coach: none, the built-in coach on an AI model you choose (a cloud key or a model on this
// computer), or an AI app you already use (Claude Desktop and others) connected over MCP.

import { useEffect, useState } from "react";
import { button, Field, input, Notice, Pill, Result } from "@/components/ui";
import { formatMonthly, monthlyEstimate } from "~/ai/cost";
import { knownPrice, PROVIDERS, preset, type ProviderKind } from "~/ai/providers";
import { coachSetup, saveCoachSetup, SECRET_AI, type CoachMode, type CoachSetup, type ModelChoice } from "~/ai/settings";
import { listModels, testModel, type ModelInfo } from "~/ai/test";
import { invoke, isDesktop, isPhone, openExternal } from "~/platform/native";
import { deleteSecret, rebindSecret, saveSecret, secretStatus } from "~/platform/secrets";

const MODES: { mode: CoachMode; title: string; line: string }[] = [
  { mode: "builtin", title: "Built-in coach", line: "Chat with a coach inside Lactic, on an AI model you pick. Use a cloud key, or run a free model on this computer." },
  { mode: "external", title: "An AI app you already use", line: "Coach through Claude Desktop (or another app that speaks MCP): you chat there, it reads your training from Lactic and suggests changes." },
  { mode: "none", title: "No coach", line: "Just the plan, the workouts and your numbers. You can add a coach later." },
];

/**
 * On the iPhone: no models on this device and no MCP server, so a cloud key or no coach. A choice
 * synced from the computer (an AI app, Ollama) keeps working there and is named here.
 */
const PHONE_MODES = new Set<CoachMode>(["builtin", "none"]);
const modeLine = (m: (typeof MODES)[number]) => (isPhone() && m.mode === "builtin" ? "Chat with a coach inside Lactic, on an AI model you pick, with a key from an AI provider." : m.line);

export function useCoachSetup() {
  const [setup, setSetup] = useState<CoachSetup | null>(null);
  useEffect(() => {
    void coachSetup().then(setSetup);
  }, []);
  const update = async (next: CoachSetup) => {
    setSetup(next);
    await saveCoachSetup(next);
  };
  return [setup, update] as const;
}

/** A labelled block of controls (Field wraps a <label>, which buttons inside mustn't share). */
function Group({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-sm text-muted">{hint}</span>}
    </div>
  );
}

function ModeCard({ active, title, line, onPick }: { active: boolean; title: string; line: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${active ? "border-accent bg-accent/5 shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:bg-raised"}`}
    >
      <span className="flex items-center gap-3">
        <span className={`grid size-4 flex-none place-items-center rounded-full border ${active ? "border-accent" : "border-control"}`}>{active && <span className="size-2 rounded-full bg-accent" />}</span>
        <span className="font-medium">{title}</span>
      </span>
      <span className="mt-1 block pl-7 text-sm text-muted">{line}</span>
    </button>
  );
}

export function CoachSetupPanel() {
  const [setup, update] = useCoachSetup();
  if (!setup) return null;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {MODES.filter((m) => !isPhone() || PHONE_MODES.has(m.mode)).map((m) => (
          <ModeCard key={m.mode} active={setup.mode === m.mode} title={m.title} line={modeLine(m)} onPick={() => void update({ ...setup, mode: m.mode })} />
        ))}
      </div>
      {isPhone() && setup.mode === "external" && <Notice>Your coach is an AI app on your computer. Chat with it there; its suggestions show up here too.</Notice>}
      {setup.mode === "builtin" && <BuiltinSetup setup={setup} update={update} />}
      {setup.mode === "builtin" && !isPhone() && <AlongsideSetup on={Boolean(setup.alongside)} onChange={(alongside) => void update({ ...setup, alongside })} />}
      {setup.mode === "external" && !isPhone() && <ExternalSetup />}
    </div>
  );
}

// --- built-in -----------------------------------------------------------------------------------

function BuiltinSetup({ setup, update }: { setup: CoachSetup; update: (s: CoachSetup) => Promise<void> }) {
  const kind = setup.provider?.kind ?? null;
  const info = kind ? preset(kind) : null;
  const [keySaved, setKeySaved] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void secretStatus(SECRET_AI).then(setKeySaved);
  }, []);

  const ready = Boolean(info && (info.local || setup.provider?.hasKey || kind === "custom"));
  useEffect(() => {
    if (!ready) return setModels(null);
    setModelsError(null);
    listModels(setup)
      .then(setModels)
      .catch((e) => {
        setModels([]);
        setModelsError(e instanceof Error ? e.message : String(e));
      });
    // Refetch when the provider or key changes.
  }, [ready, kind, setup.provider?.baseUrl, setup.provider?.hasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickProvider = (k: ProviderKind) => {
    const p = preset(k);
    void update({ ...setup, provider: { kind: k, baseUrl: p.baseUrl, hasKey: Boolean(keySaved) && !p.local && setup.provider?.kind === k }, chat: null, vision: null });
  };

  async function saveKey() {
    if (!key.trim() || !setup.provider) return;
    await saveSecret(SECRET_AI, key, setup.provider.baseUrl);
    setKeySaved(await secretStatus(SECRET_AI));
    setKey("");
    await update({ ...setup, provider: { ...setup.provider, hasKey: true } });
  }

  const chooseModel = (id: string) => {
    const m = models?.find((x) => x.id === id);
    const chat: ModelChoice = { model: id, price: m?.price ?? knownPrice(kind ?? undefined, id) };
    void update({ ...setup, chat });
  };

  async function runTest() {
    if (!setup.chat) return;
    setTesting(true);
    const tested = await testModel(setup, setup.chat);
    setTesting(false);
    await update({ ...setup, chat: { ...setup.chat, tested } });
  }

  const suggested = info?.suggested ?? [];
  const localMissing = info?.local && modelsError && !isPhone();
  const installed = info?.local ? (models ?? []) : [];
  const priceOf = (id: string) => models?.find((m) => m.id === id)?.price ?? knownPrice(kind ?? undefined, id);
  const unpriced = Boolean(info && !info.local && setup.chat && !setup.chat.price && !priceOf(setup.chat.model));

  return (
    <div className="space-y-6 rounded-lg border border-line p-5">
      <Group label={isPhone() ? "AI provider" : "Where the model runs"}>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.filter((p) => !(isPhone() && p.local)).map((p) => (
            <button
              key={p.kind}
              type="button"
              onClick={() => pickProvider(p.kind)}
              aria-pressed={kind === p.kind}
              className={`rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${kind === p.kind ? "border-accent shadow-[0_0_0_1px_var(--accent)]" : "border-line hover:bg-raised"}`}
            >
              <span className="flex items-center gap-2 font-medium">
                {p.label}
                {p.local && <Pill tone="positive">Free</Pill>}
              </span>
              <span className="mt-0.5 block text-muted">{p.blurb}</span>
            </button>
          ))}
        </div>
      </Group>
      {isPhone() && info?.local && <Notice>{info.label.replace(/ \(.*\)/, "")} runs on your computer, so this coach chats there. Pick a provider above to chat on this iPhone too.</Notice>}

      {info && kind === "custom" && (
        <Field label="Base URL" hint="The address before /chat/completions, e.g. https://api.groq.com/openai/v1">
          <input
            className={`${input} w-full`}
            defaultValue={setup.provider?.baseUrl}
            onBlur={(e) => {
              const input = e.target;
              const baseUrl = input.value.trim();
              const provider = setup.provider;
              if (!provider || baseUrl === provider.baseUrl) return;
              // With a key saved, the system asks before the key may go to the new address.
              void (provider.hasKey ? rebindSecret(SECRET_AI, baseUrl) : Promise.resolve(true)).then((ok) => {
                if (ok) void update({ ...setup, provider: { ...provider, baseUrl } });
                else input.value = provider.baseUrl;
              });
            }}
          />
        </Field>
      )}

      {info && !info.local && (
        <Group
          label="API key"
          hint={
            <>
              Kept in {isPhone() ? "this iPhone" : "your computer"}&apos;s keychain; Lactic never shows it again.{" "}
              {info.keyUrl && (
                <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal(info.keyUrl!)}>
                  Get a {info.label} key
                </button>
              )}
            </>
          }
        >
          {setup.provider?.hasKey && keySaved ? (
            <div className="flex items-center gap-3 text-sm">
              <Pill tone="positive">Saved {keySaved}</Pill>
              <button type="button" className={button.ghost} onClick={() => setup.provider && void update({ ...setup, provider: { ...setup.provider, hasKey: false } })}>
                Replace
              </button>
              <button
                type="button"
                className={button.ghost}
                onClick={async () => {
                  await deleteSecret(SECRET_AI);
                  setKeySaved(null);
                  if (setup.provider) await update({ ...setup, provider: { ...setup.provider, hasKey: false } });
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input className={`${input} min-w-0 flex-1`} type="password" placeholder={info.keyHint ?? "Key"} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveKey()} />
              <button type="button" className={button.primary} disabled={!key.trim()} onClick={() => void saveKey()}>
                Save key
              </button>
            </div>
          )}
        </Group>
      )}

      {localMissing && (
        <div className="space-y-2 rounded-md bg-raised p-4 text-sm">
          <p className="font-medium">{info!.label.replace(/ \(.*\)/, "")} isn&apos;t running on this computer yet.</p>
          {kind === "ollama" ? (
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>
                <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal("https://ollama.com/download")}>
                  Download Ollama
                </button>{" "}
                and open it.
              </li>
              <li>
                In a terminal, run <code className="rounded bg-surface px-1.5 py-0.5 text-ink">ollama pull qwen3:8b</code> (about 5 GB).
              </li>
              <li>Come back here; Lactic finds it by itself.</li>
            </ol>
          ) : (
            <p className="text-muted">Open LM Studio, download a model, and turn on its local server (Developer tab).</p>
          )}
        </div>
      )}

      {info?.local && installed.length > 0 && suggested.length > 0 && !installed.some((m) => suggested.some((s) => s.id === m.id)) && (
        <Notice>
          None of the models on this computer are ones we&apos;ve seen use tools reliably. Try{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-ink">ollama pull {suggested.find((s) => s.pick)?.id}</code>, or run &ldquo;Test this model&rdquo; on yours.
        </Notice>
      )}

      {ready && (
        <Group label="Model" hint={modelsError && !info?.local ? `Couldn't list models (${modelsError}); pick a suggestion or type a name.` : undefined}>
          <div className="space-y-2">
            {(info?.local ? installed.map((m) => ({ ...suggested.find((s) => s.id === m.id), id: m.id, label: m.id })) : suggested).map((s) => {
              const p = priceOf(s.id);
              return (
                <label key={s.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2 text-sm hover:bg-raised">
                  <input type="radio" className="mt-1" name="model" checked={setup.chat?.model === s.id} onChange={() => chooseModel(s.id)} />
                  <span>
                    <span className="flex items-center gap-2 font-medium">
                      {s.label}
                      {s.pick && <Pill tone="positive">Recommended</Pill>}
                    </span>
                    {s.note && <span className="block text-muted">{s.note}</span>}
                    {p && (
                      <span className="num block text-xs text-faint">
                        {formatMonthly(monthlyEstimate(p))} a month for daily use · ${p.input.toFixed(2)} in · ${p.output.toFixed(2)} out per million tokens
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
            {!info?.local && (
              <ModelSearch models={models ?? []} value={setup.chat?.model ?? ""} onPick={chooseModel} />
            )}
          </div>
        </Group>
      )}

      {setup.chat && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" className={button.secondary} disabled={testing} onClick={() => void runTest()}>
              {testing ? "Testing…" : "Test this model"}
            </button>
            {setup.chat.tested && !testing && (
              <Pill tone={setup.chat.tested.ok ? (setup.chat.tested.tools ? "positive" : "warning") : "negative"}>
                {setup.chat.tested.ok ? (setup.chat.tested.tools ? `Works, uses tools · ${setup.chat.tested.seconds}s` : `Answers · ${setup.chat.tested.seconds}s`) : "Didn't work"}
              </Pill>
            )}
          </div>
          {setup.chat.tested?.note && <Result ok={setup.chat.tested.ok}>{setup.chat.tested.note}</Result>}
          {unpriced && (
            <p className="text-sm text-muted">Lactic doesn&apos;t know this model&apos;s price, so the monthly limit can&apos;t count it. Set a spending limit with {info?.label} too.</p>
          )}
        </div>
      )}

      {info && <ModelGuide local={info.local} />}

      {info && !info.local && (
        <Field
          label="Monthly limit"
          hint="Lactic adds up what each coach reply costs and pauses the coach for the rest of the month when it reaches this. It's kept in Lactic, not with your provider, so also set a spending or credit limit on the key itself as a backstop."
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">$</span>
            <input
              className={`${input} w-24`}
              inputMode="decimal"
              defaultValue={setup.monthlyCapUsd ?? ""}
              placeholder="None"
              onBlur={(e) => {
                const v = e.target.value.trim();
                void update({ ...setup, monthlyCapUsd: v === "" ? null : Math.max(0, Number(v) || 0) });
              }}
            />
          </div>
        </Field>
      )}
    </div>
  );
}

/** What makes a good coach model, what to avoid, and what leaves the computer. */
function ModelGuide({ local }: { local: boolean }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Which model should I use?</summary>
      <div className="space-y-3 pt-3 text-muted">
        <p>
          The coach looks up your plan, rides and recovery with tools, then explains what it found. So the model has to be good at calling tools and following
          instructions; raw size matters less. &ldquo;Test this model&rdquo; checks exactly that.
        </p>
        <p>
          <span className="font-medium text-ink">Good picks.</span> Claude Haiku 5.5 is the best value: reliable with tools and under $1 a month for daily use.
          Claude Sonnet 5.5 coaches most thoughtfully for about $14. Open models on OpenRouter (GLM 5.3, Kimi K2.6, DeepSeek V4.1 Flash) are cheap and solid.
          On your own computer, Qwen 3 8B is the smallest that works; Qwen 3.8 27B is much better if you have 32 GB of memory.
        </p>
        <p>
          <span className="font-medium text-ink">Skip these.</span> Models under about 7B (Llama 3.2 3B, Phi, Gemma 2B): they garble tool calls and make numbers up.
          Models without tool support, and heavily shrunk downloads (Q3, Q2). Top-end models like Claude Opus or Fable, GPT Pro or Gemini Argon: they cost
          several times more and a training coach won&apos;t notice the difference.
        </p>
        <p>
          <span className="font-medium text-ink">Privacy.</span>{" "}
          {local
            ? "This model runs on your computer, so your training data never leaves it."
            : "Each reply sends the parts of your training the coach looked up (plan, rides, recovery, weight) to the provider you chose. Your API key stays in your keychain. On OpenRouter you can limit routing to providers that don't keep or train on prompts in its privacy settings." + (isPhone() ? "" : " For nothing to leave your computer, use Ollama or LM Studio.")}
        </p>
      </div>
    </details>
  );
}

function ModelSearch({ models, value, onPick }: { models: ModelInfo[]; value: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const hits = q.length < 2 ? [] : models.filter((m) => `${m.id} ${m.name ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="space-y-1">
      <input className={`${input} w-full`} placeholder={models.length ? `Or search ${models.length} models, or type a model name` : "Or type a model name"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim() && (onPick(q.trim()), setQ(""))} />
      {hits.length > 0 && (
        <ul className="rounded-md border border-line text-sm">
          {hits.map((m) => (
            <li key={m.id}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-1.5 text-left hover:bg-raised" onClick={() => (onPick(m.id), setQ(""))}>
                <span className="truncate">{m.name ?? m.id}</span>
                {m.price && <span className="num flex-none text-xs text-faint">${m.price.input.toFixed(2)} / ${m.price.output.toFixed(2)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && !models.some((m) => m.id === value) && <p className="text-xs text-muted">Using {value}</p>}
    </div>
  );
}

// --- external (MCP) -----------------------------------------------------------------------------

interface McpSetup {
  url: string | null;
  token: string | null;
  command: string;
  claudeConfig: string | null;
  claudeAdded?: boolean;
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={button.small}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** With the built-in coach, AI apps can still connect over MCP. */
function AlongsideSetup({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-lg border border-line p-4">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="block font-medium">Let AI apps connect too</span>
          <span className="block text-sm text-muted">
            Keep the built-in coach and also let Claude Desktop (or another app that speaks MCP) read your training and suggest changes. Suggestions from both show up here
            to apply or dismiss.
          </span>
        </span>
      </label>
      {on && <ExternalSetup />}
    </div>
  );
}

export function ExternalSetup() {
  const [mcp, setMcp] = useState<McpSetup | null>(null);
  const [claude, setClaude] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (isDesktop) void invoke<McpSetup>("mcp_setup").then(setMcp);
  }, []);

  async function addToClaude() {
    try {
      await invoke<string>("mcp_install_claude");
      void invoke<McpSetup>("mcp_setup").then(setMcp);
      setClaude({ ok: true, message: "Added. Quit and reopen Claude Desktop, then ask it “How's my training going?”" });
    } catch (e) {
      setClaude({ ok: false, message: String(e) });
    }
  }

  const json = mcp ? JSON.stringify({ mcpServers: { lactic: { command: mcp.command, args: ["--mcp"] } } }, null, 2) : "";
  return (
    <div className="space-y-5 rounded-lg border border-line p-5">
      {!isDesktop && <Notice>Connecting an AI app needs the Lactic desktop app.</Notice>}
      <p className="text-sm text-muted">
        You talk to the coach in that app, not in Lactic. It reads your numbers from Lactic while Lactic is open, and anything it suggests waits here for you to apply
        or dismiss.
      </p>
      <div className="space-y-3">
        <div>
          <p className="font-medium">Claude Desktop</p>
          <p className="text-sm text-muted">One click adds Lactic to Claude Desktop. Claude can then read your plan, rides, fitness and recovery, and propose changes that you approve here.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {mcp?.claudeAdded ? (
            <Pill tone="positive">Added to Claude Desktop</Pill>
          ) : (
            <button type="button" className={button.primary} disabled={!isDesktop} onClick={() => void addToClaude()}>
              Add to Claude Desktop
            </button>
          )}
          <button type="button" className={button.ghost} onClick={() => void openExternal("https://claude.ai/download")}>
            Get Claude Desktop
          </button>
        </div>
        {claude && <Result ok={claude.ok}>{claude.message}</Result>}
      </div>
      {mcp && (
        <details className="space-y-3 text-sm">
          <summary className="cursor-pointer font-medium">Other AI apps</summary>
          <div className="space-y-4 pt-3">
            <div className="space-y-2">
              <p className="text-muted">Apps that start a server from a command (Cursor, Claude Code, LM Studio, and most MCP apps):</p>
              <pre className="overflow-x-auto rounded-md bg-raised p-3 text-xs">{json}</pre>
              <Copy text={json} />
            </div>
            {mcp.url && (
              <div className="space-y-2">
                <p className="text-muted">Apps that connect to a URL on this computer: use this address with the token as a Bearer header. Lactic has to be open.</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-raised px-2 py-1.5 text-xs">{mcp.url}</code>
                  <Copy text={mcp.url} />
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-raised px-2 py-1.5 text-xs">{mcp.token ? `${mcp.token.slice(0, 6)}…` : ""}</code>
                  {mcp.token && <Copy text={mcp.token} />}
                </div>
              </div>
            )}
            <p className="text-muted">ChatGPT only connects to servers on the internet, so it can&apos;t reach Lactic on your computer yet.</p>
            <p className="text-muted">
              Whichever app you use, pick a model that is good with tools: Claude Sonnet 5.5 or Opus 5.5 in Claude Desktop, or, in an app running a model on this
              computer, something at least the size of Qwen 3 8B. Small local models garble tool calls.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
