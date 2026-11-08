// POST /api/feedback: files feedback from the Lactic app as a GitHub issue, so riders without a
// GitHub account can send it. The app sends the rider's note, the app version and OS, and only if
// they chose to, an app check and up to three screenshots. Nothing is stored here: screenshots go to
// Vercel Blob so the issue can show them, and everything else goes into the issue.
//
// Triage: before filing, it compares the note with the open feedback issues of the same kind. When
// one is clearly the same report, the note goes on that issue as a comment (with its screenshots and
// system line) and gets a "+1" count, instead of a new issue.
//
// Environment (Vercel project lactic-site):
//   GITHUB_TOKEN           fine-grained token with Issues: read and write on the repo, nothing else
//   GITHUB_REPO            optional, defaults to blairj09/lactic
//   BLOB_READ_WRITE_TOKEN  optional; set by connecting a Blob store. Without it, screenshots are skipped.

import { put } from "@vercel/blob";

const REPO = process.env.GITHUB_REPO || "blairj09/lactic";
const KINDS = { problem: "Problem", idea: "Idea", other: "Feedback" };
const OS_NAMES = { macos: "macOS", windows: "Windows", linux: "Linux" };
const MAX_MESSAGE = 5000;
const MAX_DIAGNOSTICS = 20000;
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 1_000_000;
const MAX_BODY = 4_400_000;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-lactic-client",
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

// Best effort only: each function instance remembers who sent what in the last hour.
const recent = new Map();
function tooMany(ip) {
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 3_600_000);
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 10;
}

const short = (v, n) => String(v ?? "").replace(/[^\w.\- ]/g, "").slice(0, n);
// Keep riders' text from pinging GitHub users or closing the code block it sits in.
const noMentions = (text) => text.replace(/@(?=[A-Za-z0-9])/g, "@​");
const noFence = (text) => text.replace(/`{3,}/g, "''");

export function title(kind, message) {
  const first = message.trim().split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  if (!first) return KINDS[kind];
  const cut = first.length <= 70 ? first : `${first.slice(0, 70).replace(/\s+\S*$/, "")}…`;
  return `${KINDS[kind]}: ${noMentions(cut)}`;
}

export function body({ message, system, diagnostics, images, skipped }) {
  const os = OS_NAMES[system.os] || system.os;
  const parts = [noMentions(message), ""];
  for (const url of images) parts.push(`![Screenshot](${url})`, "");
  if (skipped) parts.push(`(${skipped === 1 ? "A screenshot" : `${skipped} screenshots`} couldn't be attached.)`, "");
  parts.push("---", `Lactic ${system.version} · ${[os, system.osVersion, system.arch].filter(Boolean).join(" ")}`, "", "_Sent from the app._");
  if (diagnostics) parts.push("", "<details><summary>App check</summary>", "", "```json", noFence(diagnostics), "```", "", "</details>");
  return parts.join("\n");
}

/** Checks and tidies what the app sent. Returns an error string or the clean input. */
export function parse(input) {
  if (!input || typeof input !== "object") return "Expected JSON.";
  const kind = Object.hasOwn(KINDS, input.kind) ? input.kind : null;
  if (!kind) return "Unknown kind.";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) return "The message is empty.";
  const s = input.system || {};
  const system = { version: short(s.version, 20) || "unknown", os: short(s.os, 20) || "unknown", arch: short(s.arch, 20), osVersion: short(s.osVersion, 40) };
  const diagnostics = typeof input.diagnostics === "string" && input.diagnostics.trim() ? input.diagnostics.slice(0, MAX_DIAGNOSTICS) : null;
  const shots = Array.isArray(input.screenshots) ? input.screenshots.slice(0, MAX_SCREENSHOTS) : [];
  const screenshots = [];
  for (const shot of shots) {
    if (!shot || typeof shot.data !== "string") continue;
    const bytes = Buffer.from(shot.data, "base64");
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.subarray(0, 4).toString("hex") === "89504e47";
    if ((!jpeg && !png) || bytes.length > MAX_SCREENSHOT_BYTES) return "A screenshot isn't a JPEG or PNG under 1 MB.";
    screenshots.push({ bytes, ext: jpeg ? "jpg" : "png", type: jpeg ? "image/jpeg" : "image/png" });
  }
  return { kind, message, system, diagnostics, screenshots };
}

async function upload(screenshots) {
  if (!screenshots.length || !process.env.BLOB_READ_WRITE_TOKEN) return { images: [], skipped: screenshots.length };
  const day = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(
    screenshots.map((s, i) => put(`feedback/${day}/screenshot-${i + 1}.${s.ext}`, s.bytes, { access: "public", contentType: s.type, addRandomSuffix: true })),
  );
  const images = results.filter((r) => r.status === "fulfilled").map((r) => r.value.url);
  return { images, skipped: screenshots.length - images.length };
}

const STOP = new Set(
  "the and for with that this from have has had was were are not but you your when then than they them its it's into out about after before just like when what which while would could should there their here also only very more some any all can cant can't dont don't doesnt doesn't didnt didn't wont won't isnt isn't lactic app please thanks thank".split(" "),
);

/** The words that carry a note's meaning: lower case, no stop words, plural s dropped. */
export function words(text) {
  const out = new Set();
  for (const w of text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
  }
  return out;
}

/** How alike two notes are, 0 to 1 (Jaccard on their words). */
export function similarity(a, b) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Only what the rider wrote in an issue: the title and the note above the screenshots and system line. */
const issueText = (issue) => `${issue.title.replace(/^[A-Za-z]+:\s*/, "")}\n${(issue.body || "").split(/\n!\[Screenshot\]|\n---\n/)[0]}`;

/** Kept high on purpose: a missed duplicate costs a minute of triage, a wrong merge loses a report. */
export const DUPLICATE_AT = 0.5;

/** The open feedback issue that is the same report, if one clearly is. */
export function findDuplicate(issues, kind, message) {
  let best = null;
  for (const issue of issues) {
    if (issue.pull_request || !(issue.labels || []).some((l) => (l.name ?? l) === kind)) continue;
    const score = similarity(message, issueText(issue));
    if (score >= DUPLICATE_AT && (!best || score > best.score)) best = { issue, score };
  }
  return best?.issue ?? null;
}

const github = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "lactic-feedback",
    },
  });

async function openFeedback() {
  try {
    const res = await github("/issues?labels=feedback&state=open&per_page=100&sort=updated");
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request) {
  if (!process.env.GITHUB_TOKEN) return json(503, { error: "Feedback isn't switched on yet." });
  if (!request.headers.get("x-lactic-client")) return json(400, { error: "Send feedback from the Lactic app." });
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return json(429, { error: "That's a lot of feedback in an hour. Try again later." });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: "That's too big. Try fewer or smaller screenshots." });
  let input;
  try {
    input = parse(JSON.parse(raw));
  } catch {
    input = "Expected JSON.";
  }
  if (typeof input === "string") return json(400, { error: input });

  const [{ images, skipped }, open] = await Promise.all([upload(input.screenshots), openFeedback()]);
  const text = body({ ...input, images, skipped });

  const same = findDuplicate(open, input.kind, input.message);
  if (same) {
    const res = await github(`/issues/${same.number}/comments`, { method: "POST", body: JSON.stringify({ body: `**Another report of this, from the app:**\n\n${text}` }) });
    if (res.ok) {
      await github(`/issues/${same.number}/reactions`, { method: "POST", body: JSON.stringify({ content: "+1" }) }).catch(() => null);
      return json(200, { url: same.html_url, number: same.number, duplicate: true });
    }
    console.error("GitHub comment", res.status, await res.text().catch(() => ""));
  }

  const res = await github("/issues", { method: "POST", body: JSON.stringify({ title: title(input.kind, input.message), body: text, labels: ["feedback", input.kind] }) });
  if (!res.ok) {
    console.error("GitHub", res.status, await res.text().catch(() => ""));
    return json(502, { error: "GitHub didn't take it. Try again in a minute." });
  }
  const issue = await res.json();
  return json(201, { url: issue.html_url, number: issue.number });
}
