// Feedback as a GitHub issue: the title, body and labels, the same whichever way it's sent.
// Two ways out: a prefilled "new issue" page on GitHub for people with an account, or the relay on
// lactic.fit, which files the issue for everyone else. Nothing here touches the network.

export type FeedbackKind = "problem" | "idea" | "other";

export const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: "problem", label: "Something's wrong" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
];

export const REPO = "blairj09/lactic";
export const RELAY_URL = "https://lactic.fit/api/feedback";

/** Long enough for a real report, short enough to keep issues readable. The relay checks the same. */
export const MAX_MESSAGE = 5000;
export const MAX_DIAGNOSTICS = 20000;
/** GitHub's new-issue page handles URLs of about 8 KB; past that the body is cut. */
export const MAX_URL = 7500;
/** Screenshots go to the relay as base64 JPEGs, shrunk in the app; Vercel takes request bodies up to 4.5 MB. */
export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 1_000_000;

export interface SystemInfo {
  version: string;
  os: string;
  arch: string;
  osVersion?: string;
}

export interface Screenshot {
  name: string;
  /** image/jpeg or image/png */
  type: string;
  /** base64, no data: prefix */
  data: string;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  system: SystemInfo;
  /** The app check, as the rider saw it in the dialog. Only when they ticked the box. */
  diagnostics?: string | null;
  screenshots?: Screenshot[];
}

export interface Issue {
  title: string;
  body: string;
  labels: string[];
}

const PREFIX: Record<FeedbackKind, string> = { problem: "Problem", idea: "Idea", other: "Feedback" };

/** "Problem: the first line of the message", cut at a word near 70 characters. */
export function issueTitle(kind: FeedbackKind, message: string): string {
  const first = message.trim().split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  if (!first) return PREFIX[kind];
  const cut = first.length <= 70 ? first : `${first.slice(0, 70).replace(/\s+\S*$/, "")}…`;
  return `${PREFIX[kind]}: ${cut}`;
}

export function systemLine(system: SystemInfo): string {
  const os = { macos: "macOS", windows: "Windows", linux: "Linux" }[system.os] ?? system.os;
  return `Lactic ${system.version} · ${[os, system.osVersion, system.arch].filter(Boolean).join(" ")}`;
}

export function buildIssue(input: FeedbackInput): Issue {
  const message = input.message.trim().slice(0, MAX_MESSAGE);
  const parts = [message, "", "---", systemLine(input.system)];
  if (input.diagnostics) {
    parts.push("", "<details><summary>App check</summary>", "", "```json", input.diagnostics.slice(0, MAX_DIAGNOSTICS), "```", "", "</details>");
  }
  return { title: issueTitle(input.kind, input.message), body: parts.join("\n"), labels: ["feedback", input.kind] };
}

/** Screenshots can't ride along in a link: say so in the body so the rider drags them in. */
export function githubBody(issue: Issue, screenshots: number): Issue {
  if (!screenshots) return issue;
  const [head, ...rest] = issue.body.split("\n---\n");
  return { ...issue, body: [`${head}\n\n(Drag ${screenshots === 1 ? "your screenshot" : `your ${screenshots} screenshots`} here.)`, ...rest].join("\n---\n") };
}

/** The prefilled new-issue page. When the body is too long for a URL, the app check is left out
 *  and `trimmed` says so, so the dialog can offer to copy it for pasting. */
export function githubIssueUrl(issue: Issue): { url: string; trimmed: boolean } {
  const make = (body: string) => `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title: issue.title, body, labels: issue.labels.join(",") })}`;
  const full = make(issue.body);
  if (full.length <= MAX_URL) return { url: full, trimmed: false };
  const head = issue.body.split("\n<details>")[0];
  let body = `${head}\n\n(The app check was too long for a link. Paste it here: it's on your clipboard.)`;
  while (make(body).length > MAX_URL) body = body.slice(0, Math.floor(body.length * 0.9));
  return { url: make(body), trimmed: true };
}

/** What the relay receives. It builds the same issue on its side, so it never trusts a title or labels. */
export function relayPayload(input: FeedbackInput) {
  return {
    kind: input.kind,
    message: input.message.trim().slice(0, MAX_MESSAGE),
    system: input.system,
    diagnostics: input.diagnostics ? input.diagnostics.slice(0, MAX_DIAGNOSTICS) : null,
    screenshots: (input.screenshots ?? []).slice(0, MAX_SCREENSHOTS),
  };
}

/** The app check without the troubleshooting guide (that's Lactic's own text, not the rider's). */
export function diagnosticsText(report: Record<string, unknown>): string {
  const { guide: _guide, ...rest } = report;
  void _guide;
  return JSON.stringify(rest, null, 2);
}
