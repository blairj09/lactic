// Tauri's own IPC goes over fetch (ipc://localhost); sending it through the Rust core again would
// hang every command, so it must stay with the webview's fetch.
import { describe, expect, it, vi } from "vitest";

describe("isLocal", () => {
  it("keeps Tauri IPC and the app's own files in the webview", async () => {
    vi.stubGlobal("location", new URL("http://localhost:1420/"));
    const { isLocal } = await import("./fetch");
    for (const url of ["ipc://localhost/db_select", "http://ipc.localhost/db_select", "tauri://localhost/x", "http://localhost:1420/src/main.tsx", "data:text/plain,hi"]) {
      expect(isLocal(new URL(url)), url).toBe(true);
    }
    for (const url of ["https://intervals.icu/api/v1/athlete/0", "http://localhost:11434/v1/models"]) expect(isLocal(new URL(url)), url).toBe(false);
    vi.unstubAllGlobals();
  });
});
