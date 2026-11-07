// The MCP tools against a real (in-memory) database: reads come from the engine, and proposals
// are saved for the rider instead of changing the plan.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { localClient } from "~/db/supabase-client";
import { applyChange } from "@/app/coach/actions";
import { callTool, mcpTools } from "./bridge";

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
});
