import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const code = readFileSync(new URL("../analytics.js", import.meta.url), "utf8");

// Runs analytics.js in a fake page and reports whether it would count, plus what it stored.
function visit({ host = "lactic.fit", search = "", ua = "Mozilla/5.0 (Macintosh) Chrome/131", webdriver = false, store = {} } = {}) {
  const added = [];
  const window = {};
  const ctx = {
    window,
    location: { hostname: host, search },
    navigator: { userAgent: ua, webdriver },
    URLSearchParams,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    document: { createElement: () => ({}), head: { appendChild: (s) => added.push(s.src) } },
  };
  runInNewContext(code, ctx);
  return { counted: added.includes("/_vercel/insights/script.js"), store, queued: window.vaq || [] };
}

test("a real visitor on lactic.fit is counted", () => {
  const r = visit();
  assert.equal(r.counted, true);
  assert.equal(r.queued[0][0], "beforeSend");
});

test("?count=off stops this browser for good, ?count=on undoes it", () => {
  const store = {};
  assert.equal(visit({ search: "?count=off", store }).counted, false);
  assert.equal(visit({ store }).counted, false);
  assert.equal(visit({ search: "?count=on", store }).counted, true);
  assert.equal(visit({ store }).counted, true);
});

test("automated browsers and crawlers are never counted", () => {
  assert.equal(visit({ webdriver: true }).counted, false);
  assert.equal(visit({ ua: "Mozilla/5.0 HeadlessChrome/131" }).counted, false);
  assert.equal(visit({ ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" }).counted, false);
  assert.equal(visit({ ua: "Chrome-Lighthouse" }).counted, false);
});

test("only lactic.fit counts, not previews or local copies", () => {
  assert.equal(visit({ host: "www.lactic.fit" }).counted, true);
  assert.equal(visit({ host: "lactic-site-git-x.vercel.app" }).counted, false);
  assert.equal(visit({ host: "localhost" }).counted, false);
});

test("a blocked localStorage doesn't break counting", () => {
  const r = runInNewContext(code.replace(/localStorage/g, "brokenStorage"), {
    window: {}, location: { hostname: "lactic.fit", search: "?count=off" }, navigator: { userAgent: "Chrome" }, URLSearchParams,
    brokenStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
    document: { createElement: () => ({}), head: { appendChild() {} } },
  });
  assert.equal(r, undefined);
});
