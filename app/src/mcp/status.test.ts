import { describe, expect, it } from "vitest";
import { ago, appName, connection, friendlyName, pillLabel, seenApps } from "./status";

describe("mcp status", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  it("says how long ago", () => {
    expect(ago("2026-11-08T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-11-08T11:40:00Z", now)).toBe("20 min ago");
    expect(ago("2026-11-08T11:00:00Z", now)).toBe("1 hour ago");
    expect(ago("2026-11-06T12:00:00Z", now)).toBe("2 days ago");
  });
  it("names the app", () => {
    expect(appName({ lastSeen: { at: "", client: "Claude Desktop" }, claudeAdded: false })).toBe("Claude");
    expect(appName({ lastSeen: { at: "", client: "Cursor" }, claudeAdded: true })).toBe("Cursor");
    expect(appName({ lastSeen: { at: "", client: "local-agent-mode-lactic" }, claudeAdded: false })).toBe("Claude");
    expect(appName({ lastSeen: { at: "", client: "weird-thing-42" }, claudeAdded: false })).toBe("your AI app");
    expect(appName({ lastSeen: null, claudeAdded: true })).toBe("Claude");
    expect(appName(null)).toBe("your AI app");
  });
  it("gives apps friendly names", () => {
    expect(friendlyName("local-agent-mode-lactic")).toBe("Claude");
    expect(friendlyName("claude-ai")).toBe("Claude");
    expect(friendlyName("openai-mcp")).toBe("ChatGPT");
    expect(friendlyName("Visual Studio Code")).toBe("VS Code");
    expect(friendlyName("cursor-vscode")).toBe("Cursor");
    expect(friendlyName("gemini-cli-mcp-client")).toBe("Gemini");
    expect(friendlyName("my-tool")).toBe("AI app");
    expect(friendlyName(null)).toBe("AI app");
  });
  it("labels the pill", () => {
    const one = { lastSeen: null, claudeAdded: false, apps: [{ name: "Claude", at: "" }] };
    expect(pillLabel(one)).toBe("Claude connected");
    expect(pillLabel({ ...one, apps: [...one.apps, { name: "ChatGPT", at: "" }] })).toBe("AI connected");
    expect(pillLabel({ ...one, apps: [{ name: "AI app", at: "" }] })).toBe("AI connected");
  });
  it("lists apps, newest first", () => {
    expect(seenApps(null, { Claude: "2026-11-08T10:00:00Z", ChatGPT: "2026-11-08T11:00:00Z" }).map((a) => a.name)).toEqual(["ChatGPT", "Claude"]);
    expect(seenApps({ at: "2026-11-08T10:00:00Z", client: "local-agent-mode-lactic" }, {})).toEqual([{ name: "Claude", at: "2026-11-08T10:00:00Z" }]);
  });
  it("reads the connection", () => {
    expect(connection({ lastSeen: { at: "x", client: null }, claudeAdded: false })).toBe("active");
    expect(connection({ lastSeen: null, claudeAdded: true })).toBe("added");
    expect(connection(null)).toBe("none");
  });
});
