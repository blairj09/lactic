// Lactic's side of a plugin: one worker per plugin, a watchdog per call, crash counting, restart and
// switch-off. Everything the plugin returns is validated here before Lactic uses it, and everything it
// gets is trimmed to the metric groups the rider approved.
//
// Ride safety: calls never queue. If the previous tick hasn't answered, the new one returns "busy" and
// the field shows "–". Trainer control never waits on a plugin.
import { manifestEntries, type PluginManifest } from "./manifest";
import { ANALYSIS_BUDGET, DEFAULT_LIMITS, type CallBudget, type FailureKind, type HostToWorker, type RideInput, type SandboxLimits, type WorkerToHost } from "./protocol";
import { approvedInput, checkOutput, type PluginOutput } from "./validate";

/** The slice of `Worker` the host uses, so tests can pass a fake. */
export interface WorkerLike {
  postMessage(msg: HostToWorker): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerToHost }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface HostPolicy {
  /** Crashes (throws, heap/stack failures, bad output, killed workers) before the plugin is switched off. */
  maxCrashes: number;
  /** Over-budget ticks in a row before the plugin is switched off. */
  maxConsecutiveOverruns: number;
  /** Extra time past the tick budget before the worker is presumed stuck and terminated. */
  watchdogGraceMs: number;
  /** Time a (re)load may take, including fetching and compiling the engine on first use. */
  loadTimeoutMs: number;
}

export const DEFAULT_POLICY: HostPolicy = {
  maxCrashes: 3,
  maxConsecutiveOverruns: 5,
  watchdogGraceMs: 500,
  loadTimeoutMs: 10_000,
};

export type PluginStatus = "idle" | "loading" | "ready" | "disabled";

export type TickFailure = FailureKind | "busy" | "not-ready" | "disabled" | "invalid-output" | "killed";
export type TickResult = { ok: true; output: PluginOutput; ms: number } | { ok: false; reason: TickFailure; message: string };

/**
 * Lactic's own words for each failure. A plugin's error text (and anything it named in bad output)
 * never reaches the rider: it could say "Your Lactic licence expired, visit …" (security review).
 */
export const FAILURE_WORDS: Record<TickFailure, string> = {
  timeout: "took too long",
  memory: "ran out of memory",
  stack: "recursed too deeply",
  error: "hit an error",
  "no-entry": "is missing a part its manifest lists",
  "not-loaded": "isn't loaded",
  busy: "was still working",
  "not-ready": "is starting",
  disabled: "is switched off",
  "invalid-output": "sent something Lactic can't use",
  killed: "stopped responding",
};

interface Pending {
  seq: number;
  maxOutputBytes: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (r: TickResult) => void;
}

export interface PluginHostOptions {
  limits?: Partial<SandboxLimits>;
  policy?: Partial<HostPolicy>;
  onStatus?: (status: PluginStatus, reason?: string) => void;
}

export class PluginHost {
  readonly limits: SandboxLimits;
  readonly policy: HostPolicy;
  status: PluginStatus = "idle";
  /** Plain-words reason when switched off, for the "plugin switched off" note. */
  disabledReason: string | null = null;
  crashes = 0;
  overruns = 0;
  /** Workers started, including restarts after a kill. */
  spawns = 0;

  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private seq = 0;
  private readonly entries: string[];

  constructor(
    readonly manifest: PluginManifest,
    private readonly source: string,
    private readonly createWorker: () => WorkerLike,
    private readonly options: PluginHostOptions = {},
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.entries = manifestEntries(manifest);
  }

  /** Start the worker and load the plugin. Resolves true once it's ready. */
  start(): Promise<boolean> {
    if (this.status === "disabled") return Promise.resolve(false);
    return this.spawnAndLoad();
  }

  private setStatus(status: PluginStatus, reason?: string) {
    this.status = status;
    if (status === "disabled") this.disabledReason = reason ?? "switched off";
    this.options.onStatus?.(status, reason);
  }

  private spawnAndLoad(): Promise<boolean> {
    this.kill();
    this.setStatus("loading");
    const worker = this.createWorker();
    this.worker = worker;
    this.spawns++;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.worker !== worker) return;
        this.kill();
        this.disable("took too long to start");
        resolve(false);
      }, this.policy.loadTimeoutMs);
      worker.onerror = () => {
        clearTimeout(timer);
        if (this.worker !== worker) return;
        this.kill();
        this.disable("couldn't start");
        resolve(false);
      };
      worker.onmessage = (ev) => {
        const msg = ev.data;
        if (this.worker !== worker) return;
        if (msg.type === "fatal") {
          clearTimeout(timer);
          this.kill();
          this.disable("couldn't start");
          resolve(false);
          return;
        }
        if (msg.type !== "loaded") return;
        clearTimeout(timer);
        worker.onmessage = (e) => this.onMessage(worker, e.data);
        worker.onerror = () => this.onWorkerError(worker);
        if (msg.ok) {
          this.setStatus("ready");
          resolve(true);
        } else {
          this.kill();
          this.disable(`couldn't start (${FAILURE_WORDS[msg.failure.kind]})`);
          resolve(false);
        }
      };
      worker.postMessage({ type: "load", source: this.source, entries: this.entries, limits: this.limits });
    });
  }

  /** Run one handler for this tick. `metrics` is trimmed to approved groups before it leaves Lactic. */
  call(entry: string, metrics: Record<string, number | null | { value: number | null }>, now = Date.now() / 1000): Promise<TickResult> {
    return this.send(entry, metrics, now);
  }

  /**
   * Run a ride analysis on a saved ride, with the bigger analysis budget (2 s, 128 KB). Never call
   * this during a ride. `ride` must already be cut to the approved groups (ride-input.ts).
   */
  analyze(entry: string, ride: RideInput, metrics: Record<string, number | null | { value: number | null }>, now = Date.now() / 1000): Promise<TickResult> {
    if (!(this.manifest.contributes.analyses ?? []).some((a) => a.entry === entry)) return Promise.resolve({ ok: false, reason: "no-entry", message: `${entry} is not a ride analysis in the manifest` });
    return this.send(entry, metrics, now, ride, ANALYSIS_BUDGET);
  }

  private send(entry: string, metrics: Record<string, number | null | { value: number | null }>, now: number, ride?: RideInput, budget?: CallBudget): Promise<TickResult> {
    if (this.status === "disabled") return Promise.resolve({ ok: false, reason: "disabled", message: this.disabledReason ?? "switched off" });
    if (this.status !== "ready" || !this.worker) return Promise.resolve({ ok: false, reason: "not-ready", message: "plugin is starting" });
    if (!this.entries.includes(entry)) return Promise.resolve({ ok: false, reason: "no-entry", message: `no handler ${entry} in the manifest` });
    if (this.pending) return Promise.resolve({ ok: false, reason: "busy", message: "still working on the last tick" });
    const worker = this.worker;
    const seq = ++this.seq;
    return new Promise<TickResult>((resolve) => {
      const timer = setTimeout(() => this.onStuck(worker, seq), (budget?.tickMs ?? this.limits.tickMs) + this.policy.watchdogGraceMs);
      this.pending = { seq, timer, resolve, maxOutputBytes: budget?.maxOutputBytes ?? this.limits.maxOutputBytes };
      const input = { metrics: approvedInput(this.manifest, metrics), now, ...(ride ? { ride } : {}) };
      worker.postMessage(budget ? { type: "call", seq, entry, input, budget } : { type: "call", seq, entry, input });
    });
  }

  private settle(seq: number, result: TickResult) {
    const p = this.pending;
    if (!p || p.seq !== seq) return;
    clearTimeout(p.timer);
    this.pending = null;
    p.resolve(result);
  }

  private onMessage(worker: WorkerLike, msg: WorkerToHost) {
    if (this.worker !== worker) return;
    if (msg.type === "fatal") return this.onWorkerError(worker);
    if (msg.type !== "result") return;
    if (msg.ok) {
      const checked = checkOutput(msg.output, this.manifest, this.pending?.seq === msg.seq ? this.pending.maxOutputBytes : this.limits.maxOutputBytes);
      if (checked.ok) {
        this.overruns = 0;
        this.settle(msg.seq, { ok: true, output: checked.output, ms: msg.ms });
      } else {
        this.settle(msg.seq, { ok: false, reason: "invalid-output", message: FAILURE_WORDS["invalid-output"] });
        this.crashed(FAILURE_WORDS["invalid-output"]);
      }
      return;
    }
    const { kind } = msg.failure;
    const message = FAILURE_WORDS[kind] ?? FAILURE_WORDS.error;
    this.settle(msg.seq, { ok: false, reason: kind, message });
    if (kind === "timeout") {
      this.overruns++;
      if (this.overruns >= this.policy.maxConsecutiveOverruns) this.disable(`ran over its time limit ${this.overruns} times in a row`);
    } else {
      this.crashed(message);
      // A heap or stack failure that the worker couldn't recover from leaves it unloaded.
      if (!this.disabled && msg.restarted === false && (kind === "memory" || kind === "stack")) void this.spawnAndLoad();
    }
  }

  /** The worker didn't answer in time: QuickJS's own interrupt failed to stop it. Kill and restart. */
  private onStuck(worker: WorkerLike, seq: number) {
    if (this.worker !== worker) return;
    this.settle(seq, { ok: false, reason: "killed", message: "stopped responding" });
    this.kill();
    this.crashed("stopped responding");
    if (!this.disabled) void this.spawnAndLoad();
  }

  private onWorkerError(worker: WorkerLike) {
    if (this.worker !== worker) return;
    if (this.pending) this.settle(this.pending.seq, { ok: false, reason: "killed", message: "the plugin's engine failed" });
    this.kill();
    this.crashed("the plugin's engine failed");
    if (!this.disabled) void this.spawnAndLoad();
  }

  private get disabled() {
    return this.status === "disabled";
  }

  private crashed(reason: string) {
    this.crashes++;
    if (this.crashes >= this.policy.maxCrashes) {
      this.kill();
      this.disable(`switched off after ${this.crashes} crashes (last: ${reason})`);
    }
  }

  private disable(reason: string) {
    if (this.disabled) return;
    this.setStatus("disabled", reason);
  }

  private kill() {
    const w = this.worker;
    this.worker = null;
    if (this.pending) this.settle(this.pending.seq, { ok: false, reason: "killed", message: "plugin stopped" });
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
  }

  /** Stop the plugin for good (removed, or switched off by the rider). */
  stop(reason = "switched off") {
    this.kill();
    this.disable(reason);
  }
}
