// node --test test/  (from site/)
import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, parse, POST, slim } from "../api/strava.js";

const configure = () => {
  process.env.STRAVA_CLIENT_ID = "12345";
  process.env.STRAVA_CLIENT_SECRET = "shh";
};

test("parse takes a code or a refresh token, nothing else", () => {
  assert.deepEqual(parse({ grant_type: "authorization_code", code: "abcdef0123456789" }), { grant_type: "authorization_code", code: "abcdef0123456789" });
  assert.deepEqual(parse({ grant_type: "refresh_token", refresh_token: "abcdef0123456789" }), { grant_type: "refresh_token", refresh_token: "abcdef0123456789" });
  assert.equal(typeof parse({ grant_type: "refresh_token", refresh_token: "x&client_secret=y" }), "string");
  assert.equal(typeof parse({ grant_type: "password" }), "string");
  assert.equal(typeof parse(null), "string");
});

test("slim keeps the tokens and the athlete's name only", () => {
  const out = slim({ token_type: "Bearer", access_token: "a", refresh_token: "r", expires_at: 9, athlete: { id: 7, firstname: "J", lastname: "B", city: "Provo", weight: 77 } });
  assert.deepEqual(out, { access_token: "a", refresh_token: "r", expires_at: 9, athlete: { id: 7, firstname: "J", lastname: "B" } });
});

test("says it's off until the keys are set", async () => {
  delete process.env.STRAVA_CLIENT_ID;
  assert.equal(GET().status, 503);
  configure();
  assert.deepEqual(await GET().json(), { clientId: "12345" });
});

test("adds the secret, asks Strava and passes the tokens back", async () => {
  configure();
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url, body: new URLSearchParams(init.body) };
    return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 9, athlete: { id: 7, firstname: "J", lastname: "B" } }), { status: 200 });
  };
  try {
    const request = new Request("https://lactic.fit/api/strava", {
      method: "POST",
      headers: { "x-lactic-client": "lactic/0.1.5", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ grant_type: "authorization_code", code: "abcdef0123456789" }),
    });
    const res = await POST(request);
    assert.equal(res.status, 200);
    assert.equal(sent.url, "https://www.strava.com/oauth/token");
    assert.equal(sent.body.get("client_secret"), "shh");
    assert.equal(sent.body.get("code"), "abcdef0123456789");
    assert.equal((await res.json()).access_token, "a");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a turned-down refresh comes back as 400 so the app asks to connect again", async () => {
  configure();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "Bad Request", errors: [{ code: "invalid" }] }), { status: 400 });
  try {
    const res = await POST(
      new Request("https://lactic.fit/api/strava", {
        method: "POST",
        headers: { "x-lactic-client": "lactic/0.1.5", "x-forwarded-for": "5.6.7.8" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: "abcdef0123456789" }),
      }),
    );
    assert.equal(res.status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});
