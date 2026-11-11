// /api/strava: the Strava sign-in relay for the Lactic app.
//
// Strava's OAuth needs the app's client secret to swap a sign-in code for tokens and to refresh
// them. An open-source desktop app can't keep a secret, so the app sends the code (or its refresh
// token) here, this adds Lactic's client id and secret, asks Strava, and hands the tokens straight
// back. Nothing is stored or logged: the tokens live only in the rider's keychain.
//
//   GET  → { clientId }  (the public id the app opens Strava's sign-in page with), or 503
//   POST { grant_type: "authorization_code", code }        → Strava's token reply
//   POST { grant_type: "refresh_token", refresh_token }    → Strava's token reply
//
// The reply keeps only what the app needs: the tokens, when the access token expires, and the
// athlete's id and name.
//
// Environment (Vercel project lactic-site):
//   STRAVA_CLIENT_ID      the Lactic API app's Client ID (strava.com/settings/api)
//   STRAVA_CLIENT_SECRET  its Client Secret

// No CORS headers: the app asks from its Rust core, not from a web page, so no other site's
// script can use a visitor's browser to reach the relay.
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Best effort only: each function instance remembers who asked in the last hour.
const recent = new Map();
function tooMany(ip) {
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 3_600_000);
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 60;
}

const configured = () => Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
const TOKEN = /^[A-Za-z0-9]{10,200}$/;

/** Checks what the app sent. Returns an error string or the form to send Strava (without the secret). */
export function parse(input) {
  if (!input || typeof input !== "object") return "Expected JSON.";
  if (input.grant_type === "authorization_code") {
    if (typeof input.code !== "string" || !TOKEN.test(input.code)) return "Missing the sign-in code.";
    return { grant_type: "authorization_code", code: input.code };
  }
  if (input.grant_type === "refresh_token") {
    if (typeof input.refresh_token !== "string" || !TOKEN.test(input.refresh_token)) return "Missing the refresh token.";
    return { grant_type: "refresh_token", refresh_token: input.refresh_token };
  }
  return "Unknown grant_type.";
}

/** Only what the app keeps from Strava's token reply. */
export function slim(reply) {
  const a = reply.athlete;
  return {
    access_token: reply.access_token,
    refresh_token: reply.refresh_token,
    expires_at: reply.expires_at,
    ...(a && typeof a === "object" ? { athlete: { id: a.id, firstname: a.firstname ?? null, lastname: a.lastname ?? null } } : {}),
  };
}

export function GET() {
  if (!configured()) return json(503, { error: "Strava isn't switched on yet." });
  return json(200, { clientId: process.env.STRAVA_CLIENT_ID });
}

export async function POST(request) {
  if (!configured()) return json(503, { error: "Strava isn't switched on yet." });
  if (!request.headers.get("x-lactic-client")) return json(400, { error: "Connect Strava from the Lactic app." });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return json(429, { error: "Too many Strava sign-ins in an hour. Try again later." });

  const raw = await request.text();
  if (raw.length > 2000) return json(413, { error: "That's too big." });
  let form;
  try {
    form = parse(JSON.parse(raw));
  } catch {
    form = "Expected JSON.";
  }
  if (typeof form === "string") return json(400, { error: form });

  let res;
  try {
    res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, ...form }),
    });
  } catch {
    return json(502, { error: "Couldn't reach Strava. Try again in a minute." });
  }
  const reply = await res.json().catch(() => null);
  if (!res.ok || !reply?.access_token) {
    // 400/401: the code was used or the refresh token was revoked; the app asks the rider to connect again.
    const status = res.status === 400 || res.status === 401 ? res.status : 502;
    return json(status, { error: status === 502 ? "Strava didn't answer properly. Try again in a minute." : "Strava turned the sign-in down. Connect Strava again." });
  }
  return json(200, slim(reply));
}
