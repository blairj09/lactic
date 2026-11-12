// Saving, resetting and restoring layouts on SQLite (web/lib/layout-data.ts): one active layout per
// device, Reset keeps the rider's layout as a copy, Restore swaps a copy back in.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "./sqljs";
import { setSql } from "./sql";
import { migrate } from "./migrate";
import { localClient } from "./supabase-client";
import { deleteSavedLayout, listSavedLayouts, loadLayout, resetLayout, restoreLayout, saveLayout } from "@/lib/layout-data";
import { defaultLayout } from "@/lib/sdk/layout";
import { moveCard, removeCard, setTabHidden } from "@/lib/sdk/layout-edit";

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

describe("saving layouts", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = localClient as any;
  const mine = moveCard(setTabHidden(defaultLayout(), "health", true), "lactic.brief", 4);

  it("saves one active layout and updates it in place", async () => {
    await saveLayout(db, removeCard(defaultLayout(), "lactic.form"));
    await saveLayout(db, mine);
    expect(await loadLayout(db)).toEqual(mine);
    const { data } = await db.from("layouts").select("id").eq("active", true);
    expect(data).toHaveLength(1);
  });

  it("resets to the default and keeps the layout as a copy", async () => {
    expect(await resetLayout(db)).toEqual({ kept: true });
    expect(await loadLayout(db)).toEqual(defaultLayout());
    const copies = await listSavedLayouts(db);
    expect(copies).toHaveLength(1);
    expect(copies[0].name).toMatch(/^My layout, /);
    expect(copies[0].changes).toEqual(["Health tab hidden", "cards moved"]);
    // Nothing to keep when the layout is already the default.
    expect(await resetLayout(db)).toEqual({ kept: false });
  });

  it("restores a copy, keeping the layout it replaces", async () => {
    const other = removeCard(defaultLayout(), "lactic.last-ride");
    await saveLayout(db, other);
    const [copy] = await listSavedLayouts(db);
    await restoreLayout(db, copy.id);
    expect(await loadLayout(db)).toEqual(mine);
    const left = await listSavedLayouts(db);
    expect(left.map((c) => c.changes)).toEqual([["Last ride removed"]]);
    await deleteSavedLayout(db, left[0].id);
    expect(await listSavedLayouts(db)).toEqual([]);
    expect(await loadLayout(db)).toEqual(mine);
  });
});
