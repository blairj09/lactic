// /api/strava-post: posts one ride from the try-a-ride page (lactic.fit/ride/) to the visitor's Strava.
//
// The page opens Strava's sign-in in a popup and sends the code it gets back here with the ride's
// .fit file, title and description. This swaps the code for a token (with Lactic's client secret),
// uploads the ride, waits a little for Strava to make the activity, then disconnects Lactic from the
// visitor's Strava again. So the token never reaches the browser, nothing is stored or logged, and
// the visitor doesn't keep one of the API app's connected-athlete spots.
//
//   POST { code, fit (base64), name, description, startedAt }
//     → { activityId } once Strava has made the activity, or { activityId: null } while it's still working on it
//
// Environment: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET, the same as /api/strava.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const configured = () => Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
const CODE = /^[A-Za-z0-9]{10,200}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Base64 of a .fit file up to about 3 MB: hours of second-by-second riding. */
const MAX_FIT = 4_000_000;
const API = "https://www.strava.com/api/v3";

/** How long to wait for Strava to turn the upload into an activity before answering anyway. */
export const timing = { waitMs: 20_000, everyMs: 1_500 };

// Best effort only: each function instance remembers who posted in the last hour.
const recent = new Map();
function tooMany(ip) {
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 3_600_000);
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 20;
}

/** Only the page on this site may post: same-origin requests carry an Origin header naming this host. */
export function sameSite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Checks what the page sent. Returns an error string or the ride to post. */
export function parse(input) {
  if (!input || typeof input !== "object") return "Expected JSON.";
  const { code, fit, name, description, startedAt } = input;
  if (typeof code !== "string" || !CODE.test(code)) return "Missing the Strava sign-in code.";
  if (typeof fit !== "string" || fit.length > MAX_FIT || !BASE64.test(fit)) return "Missing the ride's .fit file.";
  if (typeof name !== "string" || !name.trim() || name.length > 200) return "Missing the ride's name.";
  if (typeof description !== "string" || description.length > 2000) return "The description is too long.";
  if (typeof startedAt !== "string" || Number.isNaN(Date.parse(startedAt))) return "Missing when the ride started.";
  return { code, fit, name: name.trim(), description, startedAt: new Date(startedAt).toISOString() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const activityIn = (error) => String(error ?? "").match(/activities\/(\d+)/)?.[1] ?? null;

export async function POST(request) {
  if (!configured()) return json(503, { error: "Strava isn't switched on yet." });
  if (!sameSite(request)) return json(403, { error: "Post rides from lactic.fit." });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return json(429, { error: "Too many rides posted in an hour. Try again later." });

  const raw = await request.text();
  if (raw.length > MAX_FIT + 5000) return json(413, { error: "That ride is too big to post." });
  let ride;
  try {
    ride = parse(JSON.parse(raw));
  } catch {
    ride = "Expected JSON.";
  }
  if (typeof ride === "string") return json(400, { error: ride });

  // 1. The code for a token.
  let token;
  try {
    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: "authorization_code", code: ride.code }),
    });
    const reply = await res.json().catch(() => null);
    if (!res.ok || !reply?.access_token) return json(400, { error: "Strava turned the sign-in down. Try posting again." });
    token = reply.access_token;
  } catch {
    return json(502, { error: "Couldn't reach Strava. Try again in a minute." });
  }

  // 2. Upload, wait for the activity, and always disconnect afterwards.
  try {
    return await upload(token, ride);
  } finally {
    await fetch("https://www.strava.com/oauth/deauthorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: token }),
    }).catch(() => {});
  }
}

async function upload(token, ride) {
  const auth = { authorization: `Bearer ${token}` };
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(ride.fit, "base64")], { type: "application/vnd.ant.fit" }), "ride.fit");
  form.append("data_type", "fit");
  form.append("name", ride.name);
  form.append("description", ride.description);
  form.append("trainer", "1");
  form.append("external_id", `lactic-ride-${ride.startedAt}`);
  let reply;
  try {
    const res = await fetch(`${API}/uploads`, { method: "POST", headers: auth, body: form });
    reply = await res.json().catch(() => ({}));
    if (res.status === 429) return json(429, { error: "Strava is busy with lots of rides right now. Try again in 15 minutes." });
    if (!res.ok && !reply.error) return json(502, { error: `Strava didn't take the ride (${res.status}).` });
  } catch {
    return json(502, { error: "Couldn't reach Strava. Try again in a minute." });
  }

  const until = Date.now() + timing.waitMs;
  for (;;) {
    if (reply.activity_id) return json(200, { activityId: String(reply.activity_id) });
    if (reply.error) {
      if (/duplicate/i.test(reply.error)) return json(200, { activityId: activityIn(reply.error), duplicate: true });
      return json(422, { error: `Strava couldn't read the ride: ${String(reply.error).slice(0, 200)}` });
    }
    const id = reply.id_str ?? reply.id;
    if (id === undefined || Date.now() >= until) return json(200, { activityId: null });
    await sleep(timing.everyMs);
    try {
      const res = await fetch(`${API}/uploads/${id}`, { headers: auth });
      if (!res.ok) return json(200, { activityId: null });
      reply = await res.json();
    } catch {
      return json(200, { activityId: null });
    }
  }
}
