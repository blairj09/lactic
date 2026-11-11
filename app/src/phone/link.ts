// The iPhone keeping in step with the computer (sync.rs does the rows). Each round sends what the
// phone changed and takes a page of what the computer changed, until both are caught up. It runs
// when the app opens or comes back to the front, every couple of minutes while it's open, and after
// Health wakes the app.

import { invoke } from "~/platform/native";
import { revalidatePath } from "~/shims/next-cache";
import { applySharedPrefs } from "~/settings/shared-prefs";
import { syncKeys } from "./keys";
import { phoneStatus, send } from "./plugin";

interface Outgoing {
  cursor: unknown;
  changes: { t: string; k: unknown[]; r: Record<string, unknown> | null }[];
  upto: number;
  more: boolean;
}

interface Reply {
  cursor: unknown;
  changes: Outgoing["changes"];
  more: boolean;
  applied: number;
  rejected: string[];
}

export interface LinkState {
  running: boolean;
  /** When the last round finished, and how it went. */
  at: number | null;
  error: string | null;
  /** Rows brought in from the computer last time (a first sync can be thousands). */
  received: number;
}

let state: LinkState = { running: false, at: null, error: null, received: 0 };
const listeners = new Set<(s: LinkState) => void>();
const publish = (next: Partial<LinkState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
};

export function onLinkState(cb: (s: LinkState) => void) {
  listeners.add(cb);
  cb(state);
  return () => void listeners.delete(cb);
}

let running: Promise<void> | null = null;

/** Syncs now (or joins the sync already running). */
export function syncWithComputer(): Promise<void> {
  running ??= (async () => {
    publish({ running: true });
    let received = 0;
    try {
      if (!(await phoneStatus()).paired) return;
      for (let round = 0; round < 500; round++) {
        const out = await invoke<Outgoing>("sync_outgoing");
        const reply = await send<Reply>("sync", { cursor: out.cursor, changes: out.changes }, 120);
        received += await invoke<number>("sync_incoming", { upto: out.upto, reply });
        if (!reply.more && !out.more) break;
      }
      // API keys after the rows, so a fresh phone has its intervals.icu connection row first. A
      // computer on an older Lactic doesn't know "keys" yet: that's not worth an error here.
      const keys = await syncKeys().catch((e: unknown) => {
        console.warn("Key sync:", e);
        return 0;
      });
      if (keys) window.dispatchEvent(new CustomEvent("lactic:settings", { detail: "secrets" }));
      publish({ at: Date.now(), error: null, received });
    } catch (e) {
      publish({ at: Date.now(), error: e instanceof Error ? e.message : String(e), received });
    } finally {
      publish({ running: false });
      if (received) {
        await applySharedPrefs().catch(() => {});
        revalidatePath("/");
        // Onboarding, features and the coach setup may have come across from the computer.
        for (const key of ["onboarding.done", "coach.setup"]) window.dispatchEvent(new CustomEvent("lactic:settings", { detail: key }));
      }
      running = null;
    }
  })();
  return running;
}

/** Forgets where the phone was in the computer's history (unpairing, or pairing anew). */
export async function resetLink() {
  await invoke("sync_forget");
}

const EVERY_MS = 2 * 60_000;

/** Keeps syncing while the app is open; returns a stop function. */
export function startLink(): () => void {
  void syncWithComputer();
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") void syncWithComputer();
  }, EVERY_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncWithComputer();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
