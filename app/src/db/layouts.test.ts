// The layouts table and loadLayout() on SQLite: no row is the default, a saved layout comes back
// checked, and a broken one falls back to the default.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "./sqljs";
import { setSql } from "./sql";
import { migrate } from "./migrate";
import { localClient } from "./supabase-client";
import { loadLayout } from "@/lib/layout-data";
import { defaultLayout } from "@/lib/sdk/layout";

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

describe("layouts", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = localClient as any;

  it("is the default layout with nothing saved", async () => {
    expect(await loadLayout(db)).toEqual(defaultLayout());
  });

  it("loads the active layout for the device", async () => {
    const mine = defaultLayout();
    mine.today = [...mine.today].reverse();
    await db.from("layouts").insert({ device: "desktop", layout: mine, active: true });
    await db.from("layouts").insert({ device: "phone", layout: { ...defaultLayout(), today: [] }, active: true });
    expect((await loadLayout(db)).today[0].widget).toBe("lactic.last-ride");
    expect(await loadLayout(db, "phone")).toEqual(defaultLayout());
  });

  it("falls back to the default when the stored layout is broken", async () => {
    await db.from("layouts").update({ active: false }).eq("device", "desktop");
    await db.from("layouts").insert({ device: "desktop", layout: { v: 1, today: "nonsense" }, active: true });
    expect((await loadLayout(db)).today).toEqual(defaultLayout().today);
  });
});
