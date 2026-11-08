// Lactic's updates. On every start (and every few hours while it stays open) the app asks GitHub
// Releases for latest.json. When a newer signed build is there, the corner prompt (prompt.tsx)
// offers it; "Update and restart" downloads it, checks its signature, installs it and restarts.
// Settings → Your data can check by hand. Nothing happens in a browser or a development build.
// The card lists what's new (the release's notes, from latest.json), and after the restart the
// new version says once what changed.

import { useSyncExternalStore } from "react";
import { isDesktop } from "~/platform/native";
import { getSetting, setSetting } from "~/settings/store";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current"; checkedAt: number }
  | { status: "available"; version: string; notes: string[] }
  | { status: "installing"; version: string; downloaded: number; total?: number }
  | { status: "restarting"; version: string }
  | { status: "error"; message: string; version?: string; notes?: string[] };

/** Just installed, shown once after the restart. */
export interface Installed {
  version: string;
  notes: string[];
}

const INSTALLED = "updates.installed";

/** Updates run only in packaged desktop builds; `tauri dev` has nothing to replace. */
export const updatesSupported = isDesktop && !import.meta.env.DEV;

const EVERY = 6 * 60 * 60 * 1000;

type Pending = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

let state: UpdateState = { status: "idle" };
let pending: Pending = null;
let dismissed: string | null = null;
let installed: Installed | null = null;
const listeners = new Set<() => void>();

function set(next: UpdateState) {
  state = next;
  for (const l of listeners) l();
}

export function getState(): UpdateState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useUpdates(): UpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** The version the rider chose "Later" for; the prompt stays away until the next start. */
export function dismissedVersion(): string | null {
  return dismissed;
}

export function dismiss() {
  if (state.status !== "available" && state.status !== "error") return;
  if (!state.version) return;
  dismissed = state.version;
  set({ status: "available", version: state.version, notes: state.notes ?? [] });
}

/** The notes of a release as a list: one line per change, Markdown bullets and links stripped. */
export function parseNotes(body: string | undefined | null): string[] {
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*|__|`/g, "").trim())
    .filter(Boolean);
}

/** The version this start updated to, if it did: what the "Updated" card shows until dismissed. */
export function justInstalled(): Installed | null {
  return installed;
}

export async function dismissInstalled() {
  installed = null;
  set({ ...state });
  await setSetting(INSTALLED, null);
}

async function loadInstalled() {
  const saved = await getSetting<Installed | null>(INSTALLED, null);
  if (!saved) return;
  // The version the updater compares against (tauri.conf.json), not the crate's.
  const version = await (await import("@tauri-apps/api/app")).getVersion();
  // A different version means the install didn't take; nothing to announce.
  if (version === saved.version) installed = saved;
  else await setSetting(INSTALLED, null);
  set({ ...state });
}

/**
 * Asks for a newer version. `quiet` (the automatic checks) keeps failures to itself: being offline
 * at start isn't worth a message. A manual check says what went wrong.
 */
export async function checkForUpdate({ quiet = false } = {}): Promise<UpdateState> {
  if (!updatesSupported) return state;
  if (state.status === "checking" || state.status === "installing" || state.status === "restarting") return state;
  const before = state;
  set({ status: "checking" });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check({ timeout: 30_000 });
    await pending?.close().catch(() => undefined);
    pending = update;
    set(update ? { status: "available", version: update.version, notes: parseNotes(update.body) } : { status: "current", checkedAt: Date.now() });
  } catch (e) {
    set(quiet ? (before.status === "available" ? before : { status: "idle" }) : { status: "error", message: describe(e) });
  }
  return state;
}

/** Downloads and installs the update found by the last check, then restarts Lactic. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;
  const version = update.version;
  const notes = parseNotes(update.body);
  let downloaded = 0;
  let total: number | undefined;
  set({ status: "installing", version, downloaded });
  try {
    // Saved first: on Windows the installer closes the app before downloadAndInstall returns.
    // If the install doesn't take, the next start sees the old version and drops it.
    await setSetting(INSTALLED, { version, notes } satisfies Installed);
    // On Windows the installer takes over here and closes the app itself.
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? undefined;
      else if (event.event === "Progress") downloaded += event.data.chunkLength;
      if (event.event !== "Finished") set({ status: "installing", version, downloaded, total });
    });
    set({ status: "restarting", version });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    set({ status: "error", message: describe(e), version, notes });
  }
}

/** Checks now and then every few hours. Returns a stop function. */
export function startUpdateChecks(): () => void {
  if (!updatesSupported) return () => undefined;
  void loadInstalled().catch(() => undefined);
  void checkForUpdate({ quiet: true });
  const timer = setInterval(() => void checkForUpdate({ quiet: true }), EVERY);
  return () => clearInterval(timer);
}

export function releaseUrl(version: string): string {
  return `https://github.com/blairj09/lactic/releases/tag/v${version.replace(/^v/, "")}`;
}

function describe(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/signature/i.test(text)) return "The download didn't match Lactic's signature, so it wasn't installed.";
  if (/network|connect|dns|timed? ?out|offline|request/i.test(text)) return "Couldn't reach GitHub to check for updates. Are you online?";
  return text;
}
