import { describe, expect, it } from "vitest";
import { buildIssue, diagnosticsText, githubBody, githubIssueUrl, issueTitle, MAX_URL, relayPayload } from "./report";

const system = { version: "0.1.1", os: "macos", osVersion: "15.1.0", arch: "aarch64" };

describe("feedback report", () => {
  it("titles an issue from the first line", () => {
    expect(issueTitle("problem", "Trainer drops in ERG\nAfter about 20 minutes")).toBe("Problem: Trainer drops in ERG");
    expect(issueTitle("idea", "   ")).toBe("Idea");
    const long = issueTitle("other", "word ".repeat(40));
    expect(long.length).toBeLessThan(90);
    expect(long.endsWith("…")).toBe(true);
  });

  it("puts the version and OS under the message, and the app check only when given", () => {
    const plain = buildIssue({ kind: "idea", message: "Dark map tiles", system });
    expect(plain.body).toContain("Lactic 0.1.1 · macOS 15.1.0 aarch64");
    expect(plain.body).not.toContain("App check");
    expect(plain.labels).toEqual(["feedback", "idea"]);
    const withCheck = buildIssue({ kind: "problem", message: "x", system, diagnostics: '{"a":1}' });
    expect(withCheck.body).toContain("<summary>App check</summary>");
  });

  it("keeps the GitHub link short enough, dropping the app check first", () => {
    const small = githubIssueUrl(buildIssue({ kind: "idea", message: "Hi", system }));
    expect(small.trimmed).toBe(false);
    expect(small.url).toContain("github.com/blairj09/lactic/issues/new?");
    expect(new URL(small.url).searchParams.get("labels")).toBe("feedback,idea");
    const big = githubIssueUrl(buildIssue({ kind: "problem", message: "Long one", system, diagnostics: "x".repeat(20000) }));
    expect(big.trimmed).toBe(true);
    expect(big.url.length).toBeLessThanOrEqual(MAX_URL);
    expect(new URL(big.url).searchParams.get("body")).toContain("Long one");
  });

  it("sends the relay only the message, system and ticked app check", () => {
    expect(relayPayload({ kind: "other", message: "  hi  ", system })).toEqual({ kind: "other", message: "hi", system, diagnostics: null, screenshots: [] });
    const shots = Array.from({ length: 5 }, (_, i) => ({ name: `${i}.jpg`, type: "image/jpeg", data: "AA==" }));
    expect(relayPayload({ kind: "problem", message: "x", system, screenshots: shots }).screenshots).toHaveLength(3);
  });

  it("asks GitHub users to drag their screenshots in, above the system line", () => {
    const issue = githubBody(buildIssue({ kind: "problem", message: "Broken chart", system }), 2);
    expect(issue.body.indexOf("Drag your 2 screenshots here")).toBeGreaterThan(0);
    expect(issue.body.indexOf("Drag")).toBeLessThan(issue.body.indexOf("Lactic 0.1.1"));
    expect(githubBody(buildIssue({ kind: "idea", message: "x", system }), 0).body).not.toContain("Drag");
  });

  it("leaves the troubleshooting guide out of the app check", () => {
    const text = diagnosticsText({ coach: { mode: "none" }, guide: { coach: ["..."] } });
    expect(text).toContain("coach");
    expect(text).not.toContain("guide");
  });
});
