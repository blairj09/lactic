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
  dataDir: string | null;
}

export async function appInfo(): Promise<AppInfo> {
  if (!isDesktop) return { version: "dev", os: "browser", arch: "", dataDir: null };
  return invoke<AppInfo>("app_info");
}

/** Opens a link in the system browser. */
export async function openExternal(url: string) {
  if (!isDesktop) return void window.open(url, "_blank", "noreferrer");
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.openUrl(url);
}
