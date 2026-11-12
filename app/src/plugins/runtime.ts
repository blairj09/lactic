// The plugin's JavaScript engine: QuickJS compiled to WebAssembly. Plugin code runs inside it with
// nothing but the language itself: no fetch, no DOM, no storage, no timers, no Tauri, no host objects.
// The only thing it gets is `lactic.register(handlers)`, and the only thing that crosses back out is
// a JSON string. Hard limits on time (interrupt), heap and stack.
//
// No browser or Node APIs here, so it runs in the worker and in Vitest alike.
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten-core";
import type { CallInput, Failure, SandboxLimits } from "./protocol";

export type LoadOutcome = { ok: true; ms: number } | { ok: false; failure: Failure; ms: number };
export type CallOutcome = { ok: true; output: string; ms: number } | { ok: false; failure: Failure; ms: number; restarted: boolean };

/** Runs inside QuickJS before the plugin. Captures JSON and friends first so a plugin that
 *  overwrites them only breaks itself, and hands the host (not the plugin) its call/entries pair. */
const bootstrap = (maxOutput: number) => `(function () {
  "use strict";
  var parse = JSON.parse, stringify = JSON.stringify, keys = Object.keys, freeze = Object.freeze,
      create = Object.create, defineProperty = Object.defineProperty, MAX = ${maxOutput};
  var handlers = create(null), registered = false;
  function register(h) {
    if (registered) throw new Error("lactic.register can only be called once");
    if (typeof h !== "object" || h === null) throw new TypeError("lactic.register needs an object of handlers");
    registered = true;
    var ks = keys(h);
    for (var i = 0; i < ks.length; i++) { var f = h[ks[i]]; if (typeof f === "function") handlers[ks[i]] = f; }
  }
  defineProperty(globalThis, "lactic", { value: freeze({ apiVersion: 1, register: register }), writable: false, configurable: false, enumerable: false });
  return {
    call: function (name, inputJson) {
      var f = handlers[name];
      if (typeof f !== "function") throw new ReferenceError("no handler " + name);
      var out = f(parse(inputJson));
      var s = stringify(out === undefined ? null : out);
      if (typeof s !== "string") s = "null";
      if (s.length > MAX) throw new RangeError("output too large");
      return s;
    },
    entries: function () { return stringify(keys(handlers)); }
  };
})()`;

type Clock = () => number;

export class SandboxRuntime {
  private rt: QuickJSRuntime | null = null;
  private ctx: QuickJSContext | null = null;
  private api: QuickJSHandle | null = null;
  private deadline = Infinity;
  private source = "";
  private entries: string[] = [];

  constructor(
    private readonly module: QuickJSWASMModule,
    private readonly limits: SandboxLimits,
    private readonly now: Clock = () => Date.now(),
  ) {}

  get loaded(): boolean {
    return this.api !== null;
  }

  /** (Re)start a fresh engine and run the plugin's top-level code. `entries` are the handler names the
   *  manifest declares; each must be registered or the load fails. */
  load(source: string, entries: string[]): LoadOutcome {
    this.source = source;
    this.entries = entries;
    return this.boot();
  }

  private boot(): LoadOutcome {
    this.teardown();
    const start = this.now();
    const rt = this.module.newRuntime();
    rt.setMemoryLimit(this.limits.memoryBytes);
    rt.setMaxStackSize(this.limits.stackBytes);
    rt.setInterruptHandler(() => this.now() > this.deadline);
    // No module loader is set, so `import()` and `import x from` fail inside the sandbox.
    const ctx = rt.newContext();
    this.rt = rt;
    this.ctx = ctx;
    this.deadline = start + this.limits.loadMs;
    try {
      const boot = ctx.evalCode(bootstrap(this.limits.maxOutputBytes), "lactic-bootstrap.js");
      if (boot.error) {
        const f = this.failure(boot.error, this.now() > this.deadline);
        boot.error.dispose();
        return this.loadFailed(f, start);
      }
      const api = boot.value;
      const ran = ctx.evalCode(this.source, "plugin.js");
      if (ran.error) {
        const f = this.failure(ran.error, this.now() > this.deadline);
        ran.error.dispose();
        api.dispose();
        return this.loadFailed(f, start);
      }
      ran.value.dispose();
      const entriesFn = ctx.getProp(api, "entries");
      const listed = ctx.callFunction(entriesFn, api);
      entriesFn.dispose();
      if (listed.error) {
        const f = this.failure(listed.error, this.now() > this.deadline);
        listed.error.dispose();
        api.dispose();
        return this.loadFailed(f, start);
      }
      const registered = JSON.parse(ctx.getString(listed.value)) as string[];
      listed.value.dispose();
      const missing = this.entries.filter((e) => !registered.includes(e));
      if (missing.length) {
        api.dispose();
        return this.loadFailed({ kind: "no-entry", message: `plugin didn't register ${missing.join(", ")}` }, start);
      }
      this.api = api;
      return { ok: true, ms: this.now() - start };
    } finally {
      this.deadline = Infinity;
    }
  }

  private loadFailed(failure: Failure, start: number): LoadOutcome {
    this.teardown();
    return { ok: false, failure, ms: this.now() - start };
  }

  /** Run one handler with the tick's time budget. A heap or stack failure restarts the engine from the
   *  plugin's source, so the next tick starts clean. */
  call(entry: string, input: CallInput): CallOutcome {
    const start = this.now();
    if (!this.api || !this.ctx) return { ok: false, failure: { kind: "not-loaded", message: "plugin is not loaded" }, ms: 0, restarted: false };
    if (!this.entries.includes(entry)) return { ok: false, failure: { kind: "no-entry", message: `no handler ${entry} in the manifest` }, ms: 0, restarted: false };
    const ctx = this.ctx;
    const fn = ctx.getProp(this.api, "call");
    const name = ctx.newString(entry);
    const arg = ctx.newString(JSON.stringify(input));
    this.deadline = start + this.limits.tickMs;
    let result;
    let overBudget = false;
    try {
      result = ctx.callFunction(fn, ctx.undefined, name, arg);
      overBudget = this.now() > this.deadline;
    } finally {
      this.deadline = Infinity;
      fn.dispose();
      name.dispose();
      arg.dispose();
    }
    if (result.error) {
      const failure = this.failure(result.error, overBudget);
      result.error.dispose();
      let restarted = false;
      if (failure.kind === "memory" || failure.kind === "stack") {
        restarted = true;
        const reboot = this.boot();
        if (!reboot.ok) this.teardown();
      }
      return { ok: false, failure, ms: this.now() - start, restarted };
    }
    const output = ctx.typeof(result.value) === "string" ? ctx.getString(result.value) : "null";
    result.value.dispose();
    return { ok: true, output, ms: this.now() - start };
  }

  /** `overBudget` is decided by the clock, so a plugin can't throw "interrupted" to pass an error off
   *  as a timeout (or the reverse). */
  private failure(err: QuickJSHandle, overBudget = false): Failure {
    let name = "";
    let message = "";
    try {
      const dumped = this.ctx!.dump(err) as unknown;
      if (dumped && typeof dumped === "object") {
        name = String((dumped as { name?: unknown }).name ?? "");
        message = String((dumped as { message?: unknown }).message ?? "");
      } else message = String(dumped);
    } catch {
      message = "unreadable error";
    }
    message = message.slice(0, 200);
    if (overBudget && /interrupted/i.test(message)) return { kind: "timeout", message: "took too long" };
    if (/out of memory/i.test(message)) return { kind: "memory", message: "ran out of memory" };
    if (/stack overflow/i.test(message) || /call stack size/i.test(message)) return { kind: "stack", message: "recursed too deeply" };
    return { kind: "error", message: name ? `${name}: ${message}` : message };
  }

  private teardown() {
    try {
      this.api?.dispose();
    } catch {
      /* already gone */
    }
    this.api = null;
    try {
      this.ctx?.dispose();
    } catch {
      /* a failed engine may refuse a clean dispose */
    }
    this.ctx = null;
    try {
      this.rt?.dispose();
    } catch {
      /* same */
    }
    this.rt = null;
  }

  dispose() {
    this.teardown();
  }
}
