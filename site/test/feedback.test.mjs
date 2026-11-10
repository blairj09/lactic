// node --test test/  (from site/)
import assert from "node:assert/strict";
import { test } from "node:test";
import { body, DAILY_CAP, filedSince, findDuplicate, parse, POST, similarity, title } from "../api/feedback.js";

const system = { version: "0.1.2", os: "macos", osVersion: "15.1", arch: "aarch64" };
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");

test("titles and bodies keep riders' text from pinging people or breaking the code block", () => {
  assert.equal(title("problem", "Hi @james\nmore"), "Problem: Hi @​james");
  const text = body({ message: "x", system, diagnostics: '{"a":"```"}', images: ["https://blob/1.jpg"], skipped: 0 });
  assert.match(text, /!\[Screenshot\]\(https:\/\/blob\/1\.jpg\)/);
  assert.match(text, /Lactic 0\.1\.2 · macOS 15\.1 aarch64/);
  assert.doesNotMatch(text.split("```json")[1], /```\n```/);
});

test("parse accepts JPEG and PNG screenshots only", () => {
  assert.equal(typeof parse({ kind: "idea", message: "x", system, screenshots: [{ data: jpeg }] }), "object");
  assert.equal(typeof parse({ kind: "idea", message: "x", screenshots: [{ data: "aGVsbG8=" }] }), "string");
  assert.equal(typeof parse({ kind: "nope", message: "x" }), "string");
  assert.equal(typeof parse({ kind: "idea", message: "  " }), "string");
});

const existing = [
  { number: 7, html_url: "https://github.com/blairj09/lactic/issues/7", title: "Problem: ERG target drops after the second interval", body: "Happens with Zwift open.\n\n---\nLactic 0.1.1 · macOS", labels: [{ name: "feedback" }, { name: "problem" }] },
  { number: 8, html_url: "https://github.com/blairj09/lactic/issues/8", title: "Idea: Dark map tiles", body: "Ride maps are too bright at night.", labels: [{ name: "feedback" }, { name: "idea" }] },
];

test("finds a clear duplicate of the same kind, and nothing for a different report", () => {
  assert.ok(similarity("ERG target drops after the second interval", "ERG drops after the second interval") > 0.5);
  assert.equal(findDuplicate(existing, "problem", "ERG target drops after the second interval with Zwift open")?.number, 7);
  assert.equal(findDuplicate(existing, "idea", "ERG target drops after the second interval with Zwift open"), null);
  assert.equal(findDuplicate(existing, "problem", "Heart rate strap won't pair on Windows"), null);
  assert.equal(findDuplicate(existing, "problem", "ERG"), null);
});

async function post(message, issues) {
  process.env.GITHUB_TOKEN = "test";
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
    if (!init.method) return new Response(JSON.stringify(issues), { status: 200 });
    return new Response(JSON.stringify({ html_url: "https://github.com/blairj09/lactic/issues/9", number: 9 }), { status: 201 });
  };
  try {
    const res = await POST(new Request("https://lactic.fit/api/feedback", { method: "POST", headers: { "x-lactic-client": "0.1.2", "x-forwarded-for": `1.2.3.${calls.length}` }, body: JSON.stringify({ kind: "problem", message, system, screenshots: [{ data: jpeg }] }) }));
    return { res, json: await res.json(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("POST files a new issue with the feedback label", async () => {
  const { res, calls } = await post("Trainer drops", existing);
  assert.equal(res.status, 201);
  const created = calls.find((c) => c.url.endsWith("/issues") && c.method === "POST");
  assert.deepEqual(created.body.labels, ["feedback", "problem"]);
  assert.match(created.body.body, /A screenshot couldn't be attached/);
});

test("POST adds a duplicate to the existing issue instead", async () => {
  const { res, json, calls } = await post("The ERG target drops after the second interval", existing);
  assert.equal(res.status, 200);
  assert.equal(json.duplicate, true);
  assert.equal(json.number, 7);
  assert.ok(calls.some((c) => c.url.endsWith("/issues/7/comments") && /Another report/.test(c.body.body)));
  assert.ok(!calls.some((c) => c.url.endsWith("/issues") && c.method === "POST"));
});

test("counts what the relay filed in the last day: new issues and its own comments", () => {
  const cutoff = "2026-11-10T00:00:00.000Z";
  const issues = [{ created_at: "2026-11-10T08:00:00Z" }, { created_at: "2026-11-09T08:00:00Z" }, { created_at: "2026-11-10T09:00:00Z", pull_request: {} }];
  const comments = [
    { created_at: "2026-11-10T08:30:00Z", body: "**Another report of this, from the app:**\n\nSame here" },
    { created_at: "2026-11-10T08:40:00Z", body: "Thanks, looking into it" },
    { created_at: "2026-11-08T08:30:00Z", body: "**Another report of this, from the app:**\n\nOld" },
  ];
  assert.equal(filedSince(issues, comments, cutoff), 2);
  assert.equal(filedSince(null, { message: "rate limited" }, cutoff), 0);
});

test("POST stops filing once a day's worth has come in", async () => {
  const now = new Date().toISOString();
  const flood = Array.from({ length: DAILY_CAP }, (_, i) => ({ number: 100 + i, title: `Problem: report ${i}`, body: "x", labels: [{ name: "feedback" }], created_at: now }));
  const { res, calls } = await post("Something entirely new went wrong with the scale", flood);
  assert.equal(res.status, 429);
  assert.ok(!calls.some((c) => c.method === "POST"));
});
