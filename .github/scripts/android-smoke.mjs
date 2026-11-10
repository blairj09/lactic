// Drives the Lactic Android app on the emulator through its WebView's DevTools (debug builds allow
// it): calls the core and the phone plugin the way the screens do, checks the answers, and saves
// a screenshot. Run by android-smoke.sh once the app is open and the socket forwarded to :9222.

import { readFileSync, writeFileSync } from "node:fs";

const out = process.env.OUT ?? "android-smoke";
const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page") ?? targets[0];
if (!page) throw new Error("No WebView page to drive");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id;
    waiting.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

/** One invoke in the page: its answer, or {error}. */
async function call(command, args = {}) {
  const expr = `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then((v) => ({ ok: v === undefined ? null : v }), (e) => ({ error: String(e?.message ?? e) }))`;
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 });
  return r.result?.result?.value ?? { error: JSON.stringify(r.result?.exceptionDetails ?? r) };
}

const results = [];
let failed = 0;
async function check(name, command, args, expect, { hard = true } = {}) {
  const r = await call(command, args);
  let ok = false;
  try {
    ok = !("error" in r) && expect(r.ok);
  } catch {
    ok = false;
  }
  if (!ok && hard) failed++;
  results.push({ name, ok, hard, answer: r });
  console.log(`${ok ? "ok  " : hard ? "FAIL" : "warn"} ${name}: ${JSON.stringify(r).slice(0, 400)}`);
  return r;
}

const now = Math.floor(Date.now() / 1000);
const workout = {
  id: "ci-ride-1",
  name: "CI ride",
  start: now - 3600 - 1800,
  end: now - 1800,
  indoor: true,
  kcal: 600,
  distanceMeters: 30000,
  heartRate: [[0, 120], [600, 140], [1200, 150]],
  power: [[0, 180], [600, 220], [1200, 240]],
  cadence: [[0, 85], [600, 90], [1200, 92]],
};

await check("core answers, as Android", "app_info", {}, (v) => v.os === "android" && v.mobile === true);
await check("plugin status", "plugin:lactic-phone|status", {}, (v) => typeof v.healthAvailable === "boolean" && v.paired === null);
await check("Bluetooth (emulator has none, so a reason)", "plugin:lactic-phone|ble_available", {}, (v) => typeof v.available === "boolean");
await check("pair with the stand-in computer", "plugin:lactic-phone|pair", { url: readFileSync(`${out}/pair-url.txt`, "utf8").trim() }, (v) => v.computer === "CI Computer");
await check("sealed request after pairing", "plugin:lactic-phone|send", { kind: "status", body: {}, timeout: 15 }, (v) => v.echo === "status");
await check("status shows the pairing", "plugin:lactic-phone|status", {}, (v) => v.paired?.computer === "CI Computer" && typeof v.paired.lastSentAt === "number");
await check("Health Connect is there", "plugin:lactic-phone|status", {}, (v) => v.healthAvailable === true, { hard: false });
await check("ride into Health Connect", "plugin:lactic-phone|save_workout", workout, (v) => v.saved === true, { hard: false });
await check("same ride again is skipped", "plugin:lactic-phone|save_workout", workout, (v) => v.saved === false && v.reason === "already saved", { hard: false });
await check("read Health Connect", "plugin:lactic-phone|read_health", { days: 3 }, (v) => v.hrvKind === "rmssd" && v.source === "healthconnect", { hard: false });
await check("secrets survive (file on Android)", "secret_set", { name: "ci", value: "abcd1234" }, () => true);
await check("secret status", "secret_status", { name: "ci" }, (v) => v === "…1234");
await check("database", "db_select", { sql: "select count(*) as n from app_settings", params: [] }, (v) => Array.isArray(v), { hard: false });
await check("unpair", "plugin:lactic-phone|unpair", {}, () => true);

const shot = await cdp("Page.captureScreenshot", { format: "png" });
if (shot.result?.data) writeFileSync(`${out}/webview.png`, Buffer.from(shot.result.data, "base64"));
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
ws.close();
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
