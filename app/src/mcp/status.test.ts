import { describe, expect, it } from "vitest";
import { ago, appName, connection } from "./status";

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
    expect(appName({ lastSeen: null, claudeAdded: true })).toBe("Claude");
    expect(appName(null)).toBe("your AI app");
  });
  it("reads the connection", () => {
    expect(connection({ lastSeen: { at: "x", client: null }, claudeAdded: false })).toBe("active");
    expect(connection({ lastSeen: null, claudeAdded: true })).toBe("added");
    expect(connection(null)).toBe("none");
  });
});
