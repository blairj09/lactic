// node --test test/  (from site/)
import assert from "node:assert/strict";
import { test } from "node:test";
import { body, parse, POST, title } from "../api/feedback.js";

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

test("POST files an issue with the feedback label", async () => {
  process.env.GITHUB_TOKEN = "test";
  delete process.env.BLOB_READ_WRITE_TOKEN;
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ html_url: "https://github.com/blairj09/lactic/issues/1", number: 1 }), { status: 201 });
  };
  try {
    const res = await POST(new Request("https://lactic.fit/api/feedback", { method: "POST", headers: { "x-lactic-client": "0.1.2", "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ kind: "problem", message: "Trainer drops", system, screenshots: [{ data: jpeg }] }) }));
    assert.equal(res.status, 201);
    assert.deepEqual(sent.labels, ["feedback", "problem"]);
    assert.match(sent.body, /A screenshot couldn't be attached/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
