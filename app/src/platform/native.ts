// The bridge to Lactic's Rust core. Outside the desktop shell (npm run dev in a browser, tests)
// `isDesktop` is false and callers use their browser fallbacks.

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import("@tauri-apps/api/core");
  return core.invoke<T>(command, args);
}

export async function listen<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const events = await import("@tauri-apps/api/event");
  return events.listen<T>(event, (e) => handler(e.payload));
}

export interface AppInfo {
  version: string;
  os: string;
  arch: string;
  /** e.g. "15.1.0" on macOS; missing from builds before 0.1.2. */
  osVersion?: string;
  dataDir: string | null;
}

export async function appInfo(): Promise<AppInfo> {
  if (!isDesktop) return { version: "dev", os: "browser", arch: "", dataDir: null };
  return invoke<AppInfo>("app_info");
}

let currentOs = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "macos" : typeof navigator !== "undefined" && /Win/.test(navigator.platform) ? "windows" : "linux";

/** Set once at boot from the Rust core; before that (and in a browser) it's a guess from the UA. */
export function setOs(os: string) {
  if (os && os !== "browser") currentOs = os;
}

/** "macos", "windows" or "linux". */
export function os(): string {
  return currentOs;
}

/** What the system calls its file browser. */
export function fileManagerName(): string {
  return currentOs === "macos" ? "Finder" : currentOs === "windows" ? "File Explorer" : "your file manager";
}

/** ⌘ on a Mac, Ctrl elsewhere. */
export function modKey(): string {
  return currentOs === "macos" ? "⌘" : "Ctrl+";
}

/** Opens a link in the system browser. */
export async function openExternal(url: string) {
  if (!isDesktop) return void window.open(url, "_blank", "noreferrer");
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl(url);
}
