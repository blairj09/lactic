// Coach-drafted plugins: a draft that runs on the sample ride becomes a review card; anything Lactic
// refuses, or that fails on the sample ride, goes back to the coach; the coach can only replace a
// plugin it drafted, with a higher version; and the guide's own example always works.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkDraftArgs } from "@/lib/coach/plugin-draft";
import { EXAMPLE_CODE, EXAMPLE_MANIFEST, PLUGIN_GUIDE } from "./coach-guide";
import { InProcessWorker, quickjs } from "./test-utils";

const installed = vi.hoisted(() => ({ current: null as null | { origin: string | null; manifest: { version: string } } }));
vi.mock("./store", () => ({ getPlugin: async () => installed.current }));

const { draftPlugin, COACH_ORIGIN } = await import("./coach-draft");

async function draft(manifest: Record<string, unknown>, code = EXAMPLE_CODE) {
  const mod = await quickjs();
  return draftPlugin({ manifest, code, reason: "Counts your time over FTP." }, () => new InProcessWorker(mod));
}

beforeEach(() => {
  installed.current = null;
});

describe("draft_plugin", () => {
  it("turns the guide's example into a review card after running it on the sample ride", async () => {
    const r = await draft(EXAMPLE_MANIFEST);
    const setting = r.proposal?.change.kind === "app" ? r.proposal.change.setting : null;
    expect(setting?.setting).toBe("plugin_draft");
    if (setting?.setting !== "plugin_draft") return;
    expect(setting.update).toBe(false);
    expect(setting.summary).toBe("Above FTP: adds 1 ride field · reads live ride, profile");
    expect(r.proposal?.reason).toBe("Counts your time over FTP.");
    expect(JSON.parse(r.content).sampleRide[0]).toMatch(/^ride field "above-ftp" at the end of the sample ride: \d+:\d\d \(this ride\)$/);
    expect(JSON.parse(setting.file).main).toBe(EXAMPLE_CODE);
  }, 30_000);

  it("sends back what Lactic refuses", async () => {
    await expect(draft({ ...EXAMPLE_MANIFEST, network: true })).rejects.toThrow(/refused.*internet/);
    await expect(draft({ ...EXAMPLE_MANIFEST, id: "lactic-extra" })).rejects.toThrow(/refused/);
  });

  it("sends back a plugin that fails on the sample ride", async () => {
    await expect(draft(EXAMPLE_MANIFEST, `lactic.register({ field: function () { throw new Error("oops"); } });`)).rejects.toThrow(/On the sample ride: ride field "above-ftp": /);
    await expect(draft(EXAMPLE_MANIFEST, `fetch("https://example.com");`)).rejects.toThrow(/didn't start/);
  }, 30_000);

  it("only replaces a plugin the coach drafted, with a higher version", async () => {
    installed.current = { origin: "https://github.com/someone/above-ftp", manifest: { version: "0.1.0" } };
    await expect(draft({ ...EXAMPLE_MANIFEST, version: "0.2.0" })).rejects.toThrow(/didn't write/);
    installed.current = { origin: COACH_ORIGIN, manifest: { version: "0.1.0" } };
    await expect(draft(EXAMPLE_MANIFEST)).rejects.toThrow(/higher version/);
    const r = await draft({ ...EXAMPLE_MANIFEST, version: "0.2.0" });
    const setting = r.proposal?.change.kind === "app" ? r.proposal.change.setting : null;
    expect(setting?.setting === "plugin_draft" && setting.update).toBe(true);
    expect(r.proposal?.summary).toMatch(/^Update Above FTP to 0.2.0: /);
  }, 30_000);

  it("never takes one of Lactic's own plugin ids", async () => {
    await expect(draft({ ...EXAMPLE_MANIFEST, id: "zones" })).rejects.toThrow(/Lactic's own/);
  });
});

describe("the draft's arguments", () => {
  it("drops an author and homepage, and fills in what a draft can leave out", () => {
    const d = checkDraftArgs({ manifest: { ...EXAMPLE_MANIFEST, author: "Lactic team", homepage: "https://x.example/" }, code: "x", reason: " r " });
    expect(d.manifest).not.toHaveProperty("author");
    expect(d.manifest).not.toHaveProperty("homepage");
    expect(d.manifest).toMatchObject({ apiVersion: 1, main: "main.js", contributes: { widgets: [] } });
    expect(d.reason).toBe("r");
  });

  it("refuses code that's missing or too big", () => {
    expect(() => checkDraftArgs({ manifest: {}, code: "" })).toThrow(/code/);
    expect(() => checkDraftArgs({ manifest: {}, code: "x".repeat(70_000) })).toThrow(/KB/);
    expect(() => checkDraftArgs({ manifest: "not json", code: "x" })).toThrow(/manifest/);
  });

  it("hands the coach the SDK's types", () => {
    expect(PLUGIN_GUIDE).toContain("export type KitNode");
    expect(PLUGIN_GUIDE).not.toContain("export function definePlugin");
  });
});
