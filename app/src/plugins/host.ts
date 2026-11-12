// Lactic's side of a plugin: one worker per plugin, a watchdog per call, crash counting, restart and
// switch-off. Everything the plugin returns is validated here before Lactic uses it, and everything it
// gets is trimmed to the metric groups the rider approved.
//
// Ride safety: calls never queue. If the previous tick hasn't answered, the new one returns "busy" and
// the field shows "–". Trainer control never waits on a plugin.
import { manifestEntries, type PluginManifest } from "./manifest";
import { DEFAULT_LIMITS, type FailureKind, type HostToWorker, type SandboxLimits, type WorkerToHost } from "./protocol";
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

interface Pending {
  seq: number;
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
          this.disable(`couldn't start: ${msg.failure.message}`);
          resolve(false);
        }
      };
      worker.postMessage({ type: "load", source: this.source, entries: this.entries, limits: this.limits });
    });
  }

  /** Run one handler for this tick. `metrics` is trimmed to approved groups before it leaves Lactic. */
  call(entry: string, metrics: Record<string, number | null | { value: number | null }>, now = Date.now() / 1000): Promise<TickResult> {
    if (this.status === "disabled") return Promise.resolve({ ok: false, reason: "disabled", message: this.disabledReason ?? "switched off" });
    if (this.status !== "ready" || !this.worker) return Promise.resolve({ ok: false, reason: "not-ready", message: "plugin is starting" });
    if (!this.entries.includes(entry)) return Promise.resolve({ ok: false, reason: "no-entry", message: `no handler ${entry} in the manifest` });
    if (this.pending) return Promise.resolve({ ok: false, reason: "busy", message: "still working on the last tick" });
    const worker = this.worker;
    const seq = ++this.seq;
    return new Promise<TickResult>((resolve) => {
      const timer = setTimeout(() => this.onStuck(worker, seq), this.limits.tickMs + this.policy.watchdogGraceMs);
      this.pending = { seq, timer, resolve };
      worker.postMessage({ type: "call", seq, entry, input: { metrics: approvedInput(this.manifest, metrics), now } });
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
      const checked = checkOutput(msg.output, this.manifest, this.limits.maxOutputBytes);
      if (checked.ok) {
        this.overruns = 0;
        this.settle(msg.seq, { ok: true, output: checked.output, ms: msg.ms });
      } else {
        this.settle(msg.seq, { ok: false, reason: "invalid-output", message: checked.error });
        this.crashed(`sent something Lactic can't use (${checked.error})`);
      }
      return;
    }
    const { kind, message } = msg.failure;
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
