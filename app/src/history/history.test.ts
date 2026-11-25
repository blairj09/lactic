import { beforeEach, describe, expect, it } from "vitest";
import { openSqlJs } from "~/db/sqljs";
import { setSql, sql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { createLocalClient } from "~/db/supa";
import { captureAround, recordChange, setChangeTitle } from "./changes";
import { entryChanges, listEntries, planUndo, undoEntry } from "./store";
import { describeChanges, titleFor } from "./describe";

let supabase: ReturnType<typeof createLocalClient>;

beforeEach(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
  supabase = createLocalClient();
});

const goal = { name: "UTCX State Champs", event_date: "2026-11-27", priority: "A", kind: "cyclocross" };

async function addGoal() {
  const { data } = await supabase.from("training_goals").insert(goal).select("id").single();
  return (data as { id: string }).id;
}

describe("App history", () => {
  it("records nothing outside a change", async () => {
    await addGoal();
    expect(await listEntries()).toEqual([]);
  });

  it("records a change with its author, and titles it from the rows", async () => {
    const id = await addGoal();
    await recordChange({ author: "coach" }, async () => {
      await supabase.from("training_goals").update({ event_date: "2026-11-28" }).eq("id", id);
    });
    const [entry] = await listEntries();
    expect(entry).toMatchObject({ author: "coach", title: "Moved UTCX State Champs to Sat, Nov 28", undoneAt: null });
    const lines = describeChanges(await entryChanges(entry.id));
    expect(lines).toEqual([{ section: "Events", label: "UTCX State Champs", was: "Fri, Nov 27 · A priority", now: "Sat, Nov 28 · A priority" }]);
  });

  it("keeps a row written twice as one change, and drops writes that changed nothing", async () => {
    await supabase.from("athlete_settings").upsert({ ftp_watts: 255 }, { onConflict: "user_id" });
    await recordChange({}, async () => {
      await supabase.from("athlete_settings").upsert({ ftp_watts: 258 }, { onConflict: "user_id" });
      await supabase.from("athlete_settings").upsert({ ftp_watts: 262 }, { onConflict: "user_id" });
    });
    await recordChange({}, async () => {
      await supabase.from("athlete_settings").upsert({ ftp_watts: 262 }, { onConflict: "user_id" });
    });
    const entries = await listEntries();
    expect(entries.map((e) => e.title)).toEqual(["FTP 255 W → 262 W"]);
  });

  it("uses a title given once the work is done", async () => {
    await recordChange({ author: "coach" }, async () => {
      await addGoal();
      setChangeTitle("Added UTCX State Champs on Fri, Nov 27");
    });
    expect((await listEntries())[0].title).toBe("Added UTCX State Champs on Fri, Nov 27");
  });

  it("undoes an edit, an add and a delete, and records the undo", async () => {
    const id = await addGoal();
    await recordChange({}, async () => {
      await supabase.from("training_goals").update({ event_date: "2026-11-28" }).eq("id", id);
      await supabase.from("plan_breaks").insert({ start_date: "2026-12-01", end_date: "2026-12-05", kind: "travel", riding: "none" });
    });
    const [entry] = await listEntries();
    await undoEntry(entry.id);
    const { data: back } = await supabase.from("training_goals").select("event_date").eq("id", id).single();
    expect(back).toEqual({ event_date: "2026-11-27" });
    expect((await supabase.from("plan_breaks").select("id")).data).toEqual([]);

    const entries = await listEntries();
    expect(entries[0]).toMatchObject({ title: `Undid: ${entry.title}`, undoOf: entry.id });
    expect(entries[1].undoneAt).not.toBeNull();
    await expect(undoEntry(entry.id)).rejects.toThrow("Already undone");

    // Undoing the undo puts the change back, and the first counts as done again.
    await undoEntry(entries[0].id);
    expect((await supabase.from("training_goals").select("event_date").eq("id", id).single()).data).toEqual({ event_date: "2026-11-28" });
    expect((await listEntries()).find((e) => e.id === entry.id)?.undoneAt).toBeNull();

    await recordChange({}, async () => {
      await supabase.from("training_goals").delete().eq("id", id);
    });
    await undoEntry((await listEntries())[0].id);
    expect((await supabase.from("training_goals").select("name").eq("id", id).single()).data).toEqual({ name: goal.name });
  });

  it("leaves a row that changed again since as it is now", async () => {
    await recordChange({}, async () => {
      await supabase.from("plan_days").upsert({ day: "2026-11-26", planned: { workout: { name: "Sweet spot" }, duration: 4500 } }, { onConflict: "user_id,day" });
      await supabase.from("plan_days").upsert({ day: "2026-11-27", planned: { workout: { name: "Openers" }, duration: 2400 } }, { onConflict: "user_id,day" });
    });
    const [entry] = await listEntries();
    expect(entry.title).toBe("Changed the plan on 2 days");
    await supabase.from("plan_days").update({ planned: null }).eq("day", "2026-11-27");

    const plan = await planUndo(entry.id);
    expect(plan.kept.map((l) => l.label)).toEqual(["Fri, Nov 27"]);
    const done = await undoEntry(entry.id);
    expect(done.kept).toHaveLength(1);
    const days = (await supabase.from("plan_days").select("day").order("day")).data;
    expect(days).toEqual([{ day: "2026-11-27" }]);
  });

  it("won't remove a row something newer points at", async () => {
    let id = "";
    await recordChange({}, async () => {
      id = await addGoal();
    });
    const [entry] = await listEntries();
    await supabase.from("training_plans").insert({ name: "Champs build", start_date: "2026-11-01", end_date: "2026-11-27", goal: "event", goal_id: id });
    await expect(undoEntry(entry.id)).rejects.toThrow("nothing to undo");
  });

  it("brings back rows a delete took with it", async () => {
    const id = await addGoal();
    await supabase.from("training_plans").insert({ name: "Champs build", start_date: "2026-11-01", end_date: "2026-11-27", goal: "event", goal_id: id });
    await recordChange({}, async () => {
      await supabase.from("training_goals").delete().eq("id", id);
    });
    const [entry] = await listEntries();
    await undoEntry(entry.id);
    const { data } = await supabase.from("training_plans").select("goal_id").single();
    expect(data).toEqual({ goal_id: id });
  });

  it("records raw SQL writes wrapped in captureAround", async () => {
    await recordChange({ pluginId: "zones", title: "Turned off Zones" }, () =>
      captureAround([{ table: "app_settings", where: "key = ?", params: ["k"] }], () => sql().execute(`INSERT INTO app_settings (key, value, updated_at) VALUES ('k', '1', '2026-01-01')`)),
    );
    const entries = await listEntries({ filter: "plugins" });
    expect(entries.map((e) => e.title)).toEqual(["Turned off Zones"]);
    expect(await listEntries({ filter: "coach" })).toEqual([]);
  });

  it("names a plugin update and an unknown mix", () => {
    const row = (name: string, version: string) => ({ plugin_id: "w", name, version });
    expect(titleFor([{ table: "plugins", before: row("W′ Balance", "1.2.0"), after: row("W′ Balance", "1.3.0") }])).toBe("Updated W′ Balance to 1.3.0");
    expect(titleFor([{ table: "plan_breaks", before: null, after: { kind: "travel", start_date: "2026-12-01", end_date: "2026-12-02" } }, { table: "plan_days", before: null, after: { day: "2026-12-01" } }])).toBe(
      "Added a break, and 1 more change",
    );
  });
});
