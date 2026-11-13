// The iPhone's own layout (web/lib/layout-data.ts): it follows the computer's until the phone
// changes it, then each keeps its own; Reset on the phone saves the default as the phone's.
import { beforeAll, describe, expect, it } from "vitest";
import { openSqlJs } from "./sqljs";
import { setSql } from "./sql";
import { migrate } from "./migrate";
import { localClient } from "./supabase-client";
import { loadLayout, resetLayout, saveLayout } from "@/lib/layout-data";
import { defaultLayout } from "@/lib/sdk/layout";

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

describe("the phone's layout", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = localClient as any;
  const reversed = () => {
    const l = defaultLayout();
    l.today = [...l.today].reverse();
    return l;
  };

  it("follows the computer's until the phone changes it", async () => {
    await saveLayout(db, reversed(), "desktop");
    expect((await loadLayout(db, "phone")).today[0].widget).toBe(
      "lactic.last-ride",
    );
  });

  it("keeps its own once changed, and the computer's stays as it was", async () => {
    const mine = defaultLayout();
    mine.today = mine.today.map((c) =>
      c.widget === "lactic.form" ? { ...c, hidden: true } : c,
    );
    await saveLayout(db, mine, "phone");
    expect(
      (await loadLayout(db, "phone")).today.find(
        (c) => c.widget === "lactic.form",
      )?.hidden,
    ).toBe(true);
    expect((await loadLayout(db, "phone")).today[0].widget).toBe(
      defaultLayout().today[0].widget,
    );
    expect((await loadLayout(db, "desktop")).today[0].widget).toBe(
      "lactic.last-ride",
    );
  });

  it("resets to Lactic's default, not back to the computer's", async () => {
    const { kept } = await resetLayout(db, "phone");
    expect(kept).toBe(true);
    expect(await loadLayout(db, "phone")).toEqual(defaultLayout());
    expect((await loadLayout(db, "desktop")).today[0].widget).toBe(
      "lactic.last-ride",
    );
  });
});
