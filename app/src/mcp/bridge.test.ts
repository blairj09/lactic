// The MCP tools against a real (in-memory) database: reads come from the engine, and proposals
// are saved for the rider instead of changing the plan.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { localClient } from "~/db/supabase-client";
import { applyChange } from "@/app/coach/actions";
import { callTool, cardResource, mcpTools } from "./bridge";
import { CARD_ACTION_TOOL, CARD_URI, safePath, thinStream } from "./card-data";

const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
  await localClient.from("athlete_settings").upsert({ ftp_watts: 250, timezone: "UTC", weight_kg: 72, availability: [60, 60, 60, 60, 60, 120, 90] });
  const today = iso(new Date());
  const end = iso(new Date(Date.now() + 70 * 86_400_000));
  await localClient.from("training_plans").insert({ name: "Raise FTP", start_date: today, end_date: end, goal: "ftp" });
});

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe("MCP tools", () => {
  it("lists the coach's tools in MCP's shape", () => {
    const tools = mcpTools();
    expect(tools[0].name).toBe("get_overview");
    expect(tools.find((t) => t.name === "get_fitness")?.inputSchema).toMatchObject({ type: "object" });
    expect(tools.some((t) => t.name === "propose_workout")).toBe(true);
  });

  it("says which tools only read and which can change things", () => {
    const tools = mcpTools(true);
    for (const t of tools) {
      expect(t.title).toBeTruthy();
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations.destructiveHint).toBe("boolean");
    }
    const ann = (name: string) => tools.find((t) => t.name === name)?.annotations;
    expect(ann("get_overview")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(ann("propose_workout")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(ann("forget")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(ann(CARD_ACTION_TOOL)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(ann("remember")?.readOnlyHint).toBe(false);
  });

  it("reads the engine's numbers", async () => {
    const overview = JSON.parse(textOf(await callTool("get_overview", {})));
    expect(JSON.stringify(overview)).toContain("250");
    const athlete = JSON.parse(textOf(await callTool("get_athlete", {})));
    expect(athlete.ftp ?? athlete.ftpWatts ?? JSON.stringify(athlete)).toBeTruthy();
  });

  it("saves proposals for the rider instead of applying them", async () => {
    const tomorrow = iso(new Date(Date.now() + 86_400_000));
    const r = await callTool("propose_reset_day", { date: tomorrow, reason: "Back to plan" });
    expect(textOf(r)).toContain("Apply");
    const { data } = await localClient.from("coach_proposals").select("*");
    expect(data).toHaveLength(1);
    const row = (data as { proposal: { change: { kind: string } } }[])[0];
    expect(row.proposal.change.kind).toBe("reset");
    expect(await applyChange(localClient as never, row.proposal.change as never)).toMatch(/^Done/);
  });

  it("returns errors as text the model can act on", async () => {
    const r = await callTool("propose_workout", { date: "2020-01-01", workout_id: "nope", reason: "x" });
    expect(r.isError).toBe(true);
    expect((await callTool("no_such_tool", {})).isError).toBe(true);
  });

  it("shows cards only to AI apps that show them", async () => {
    const plain = mcpTools();
    expect(plain.some((t) => t.name === CARD_ACTION_TOOL)).toBe(false);
    expect(plain.every((t) => !("_meta" in t))).toBe(true);
    const ui = mcpTools(true);
    expect(ui.find((t) => t.name === "propose_workout")?._meta).toMatchObject({ ui: { resourceUri: CARD_URI } });
    expect(ui.find((t) => t.name === "get_overview")?._meta).toBeUndefined();
    expect(ui.find((t) => t.name === CARD_ACTION_TOOL)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
    expect((await callTool(CARD_ACTION_TOOL, { action: "status", proposal_id: "x" })).isError).toBe(true);
    expect((await cardResource()).resources?.[0].uri).toBe(CARD_URI);
  });

  it("applies a proposal from its card", async () => {
    const tomorrow = iso(new Date(Date.now() + 86_400_000));
    const r = (await callTool("propose_reset_day", { date: tomorrow, reason: "Back to plan" }, true)) as { structuredContent?: { view: string; id: string } };
    expect(r.structuredContent?.view).toBe("proposal");
    const id = r.structuredContent!.id;
    const status = (await callTool(CARD_ACTION_TOOL, { action: "status", proposal_id: id }, true)) as { structuredContent?: { status: string } };
    expect(status.structuredContent?.status).toBe("pending");
    const applied = (await callTool(CARD_ACTION_TOOL, { action: "apply", proposal_id: id }, true)) as { structuredContent?: { status: string } };
    expect(applied.structuredContent?.status).toBe("applied");
    const again = await callTool(CARD_ACTION_TOOL, { action: "apply", proposal_id: id }, true);
    expect(textOf(again)).toBe("Already applied.");
  });

  it("charts fitness on a card", async () => {
    const r = (await callTool("get_fitness", {}, true)) as { structuredContent?: { view: string; days: unknown[] } };
    expect(r.structuredContent?.view).toBe("fitness");
    expect((await callTool("get_fitness", {})) as object).not.toHaveProperty("structuredContent");
  });
});

describe("card data", () => {
  it("thins a long ride to a few hundred points", () => {
    const watts = Array.from({ length: 1000 }, (_, i) => i);
    const thin = thinStream({ step: 5, watts, heartRate: null, cadence: null, target: watts.map((w) => (w < 500 ? null : w)) }, 400);
    expect(thin.step).toBe(15);
    expect(thin.watts).toHaveLength(334);
    expect(thin.watts![0]).toBe(1);
    expect(thin.target![0]).toBeNull();
  });

  it("opens only Lactic's own pages", () => {
    expect(safePath("/rides/abc")).toBe("/rides/abc");
    expect(safePath("//evil.com")).toBeNull();
    expect(safePath("https://evil.com")).toBeNull();
    expect(safePath("/x\"><script>")).toBeNull();
  });
});
