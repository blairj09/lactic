// Startup: the database first (open and bring up to date), then the settings that decide what the
// web app's shared code sees (the coach on or off), then the app.

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { readTheme, setTheme } from "@shared/theme";
import { setSql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { isDesktop, appInfo, setOs } from "~/platform/native";
import { tauriSql } from "~/platform/tauri-sql";
import { installFetch } from "~/platform/fetch";
import { installWebBluetooth } from "~/bluetooth/web-bluetooth";
import { registerRoutes } from "./routes";
import { applyEnv } from "./env";
import { isDemo } from "~/demo/flag";

export async function boot() {
  setTheme(readTheme());
  const info = await appInfo().catch(() => null);
  if (info) setOs(info.os);
  if (info?.os === "macos") document.documentElement.dataset.desktop = "macos";
  const root = createRoot(document.getElementById("root")!);
  try {
    let db = tauriSql;
    if (!isDesktop) {
      const { openSqlJs } = await import("~/db/sqljs");
      const wasm = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
      // The website demo starts fresh on every visit.
      db = await openSqlJs({ wasmUrl: wasm, persist: !isDemo });
    }
    await migrate(db);
    setSql(db);
    installFetch();
    await installWebBluetooth();
    registerRoutes();
    if (isDemo) await (await import("~/demo/setup")).setupDemo();
    await applyEnv();
    const { default: App } = await import("~/app/App");
    root.render(createElement(App));
    if (isDemo && window.parent !== window) window.parent.postMessage({ lactic: "ready" }, "*");
  } catch (e) {
    console.error(e);
    root.render(createElement("pre", { style: { padding: 24, whiteSpace: "pre-wrap" } }, `Lactic couldn't start.\n\n${e instanceof Error ? e.stack ?? e.message : String(e)}`));
  }
}
