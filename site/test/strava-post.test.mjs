// node --test test/  (from site/)
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, POST, sameSite, timing } from "../api/strava-post.js";

process.env.STRAVA_CLIENT_ID = "12345";
process.env.STRAVA_CLIENT_SECRET = "shh";
timing.everyMs = 1;
timing.waitMs = 50;

const ride = { code: "abcdef0123456789", fit: Buffer.from("fitfile").toString("base64"), name: "Sweet spot 2 × 8", description: "▂▃▅▅\n\nTrained with Lactic · lactic.fit", startedAt: "2026-11-18T23:00:00.000Z" };
const post = (body, origin = "https://lactic.fit") =>
  POST(new Request("https://lactic.fit/api/strava-post", { method: "POST", headers: { ...(origin ? { origin } : {}), "x-forwarded-for": `9.9.9.${Math.random()}` }, body: JSON.stringify(body) }));

/** Fakes Strava: answers by URL, records every call. */
function fakeStrava(answers) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, answer] of answers) if (String(url).includes(match)) return typeof answer === "function" ? answer(calls) : new Response(JSON.stringify(answer.body ?? answer), { status: answer.status ?? 200 });
    return new Response("{}", { status: 404 });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

test("parse checks every field", () => {
  assert.equal(typeof parse(ride), "object");
  assert.equal(typeof parse({ ...ride, code: "x&y" }), "string");
  assert.equal(typeof parse({ ...ride, fit: "not base64!" }), "string");
  assert.equal(typeof parse({ ...ride, name: " " }), "string");
  assert.equal(typeof parse({ ...ride, startedAt: "soon" }), "string");
  assert.equal(typeof parse(null), "string");
});

test("only the page on this site may post", () => {
  const req = (origin) => new Request("https://lactic.fit/api/strava-post", { method: "POST", headers: origin ? { origin } : {} });
  assert.equal(sameSite(req("https://lactic.fit")), true);
  assert.equal(sameSite(req("https://evil.example")), false);
  assert.equal(sameSite(req(null)), false);
});

test("posts the ride, waits for the activity and disconnects", async () => {
  const strava = fakeStrava([
    ["/oauth/token", { access_token: "tok" }],
    ["/uploads/55", { id: 55, activity_id: 999 }],
    ["/uploads", { id: 55, id_str: "55", activity_id: null, error: null }],
    ["/oauth/deauthorize", {}],
  ]);
  try {
    const res = await post(ride);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { activityId: "999" });
    const urls = strava.calls.map((c) => c.url);
    assert.equal(new URLSearchParams(strava.calls[0].init.body).get("client_secret"), "shh");
    const form = strava.calls[1].init.body;
    assert.equal(form.get("name"), ride.name);
    assert.equal(form.get("description"), ride.description);
    assert.equal(form.get("data_type"), "fit");
    assert.equal(urls.at(-1), "https://www.strava.com/oauth/deauthorize");
    assert.equal(new URLSearchParams(strava.calls.at(-1).init.body).get("access_token"), "tok");
  } finally {
    strava.restore();
  }
});

test("still disconnects when the upload fails", async () => {
  const strava = fakeStrava([
    ["/oauth/token", { access_token: "tok" }],
    ["/uploads", { id: 5, error: "Improperly formatted data." }],
    ["/oauth/deauthorize", {}],
  ]);
  try {
    const res = await post(ride);
    assert.equal(res.status, 422);
    assert.equal(strava.calls.at(-1).url, "https://www.strava.com/oauth/deauthorize");
  } finally {
    strava.restore();
  }
});

test("a duplicate points at the activity already there", async () => {
  const strava = fakeStrava([
    ["/oauth/token", { access_token: "tok" }],
    ["/uploads", { id: 5, error: "ride.fit duplicate of <a href='/activities/4242' target='_blank'>Sweet spot</a>" }],
    ["/oauth/deauthorize", {}],
  ]);
  try {
    assert.deepEqual(await (await post(ride)).json(), { activityId: "4242", duplicate: true });
  } finally {
    strava.restore();
  }
});

test("answers without an id when Strava is slow", async () => {
  const strava = fakeStrava([
    ["/oauth/token", { access_token: "tok" }],
    ["/uploads", { body: { id: 5, activity_id: null, error: null, status: "Your activity is still being processed." } }],
    ["/oauth/deauthorize", {}],
  ]);
  try {
    assert.deepEqual(await (await post(ride)).json(), { activityId: null });
  } finally {
    strava.restore();
  }
});

test("turns away other sites and a bad sign-in", async () => {
  assert.equal((await post(ride, "https://evil.example")).status, 403);
  const strava = fakeStrava([["/oauth/token", { status: 400, body: { message: "Bad Request" } }]]);
  try {
    assert.equal((await post(ride)).status, 400);
    assert.equal(strava.calls.length, 1);
  } finally {
    strava.restore();
  }
});
