import { beforeEach, describe, expect, it } from "vitest";
import { openSqlJs } from "./sqljs";
import { setSql } from "./sql";
import { migrate } from "./migrate";
import { createLocalClient } from "./supa";
import { LOCAL_USER } from "./schema";

let supabase: ReturnType<typeof createLocalClient>;

beforeEach(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
  supabase = createLocalClient();
});

describe("local supabase client", () => {
  it("inserts with generated ids and owner, and reads JSON back", async () => {
    const { data, error } = await supabase
      .from("training_goals")
      .insert({ name: "Cross race", event_date: "2026-12-01", priority: "A", kind: "cyclocross", start_time: "09:30" })
      .select("id, user_id, name, start_time")
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ user_id: LOCAL_USER, name: "Cross race", start_time: "09:30:00" });
    expect((data as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps one favorite per workout and removes it", async () => {
    const add = () => supabase.from("workout_favorites").upsert({ workout_key: "library:tempo-45" }, { onConflict: "user_id,workout_key", ignoreDuplicates: true });
    expect((await add()).error).toBeNull();
    expect((await add()).error).toBeNull();
    const listed = await supabase.from("workout_favorites").select("workout_key");
    expect(listed.data).toEqual([{ workout_key: "library:tempo-45" }]);
    await supabase.from("workout_favorites").delete().eq("workout_key", "library:tempo-45");
    expect((await supabase.from("workout_favorites").select("workout_key")).data).toEqual([]);
  });

  it("upserts on a conflict target and keeps the row's id", async () => {
    const row = { source: "fit", external_id: "a1", name: "One", started_at: "2026-11-01T10:00:00Z", duration_seconds: 3600, power_curve: { "60": 300 }, power_histogram: [1, 2, 3] };
    const first = await supabase.from("activities").upsert([row], { onConflict: "user_id,source,external_id" }).select("id, source, external_id");
    const second = await supabase.from("activities").upsert([{ ...row, name: "Renamed" }], { onConflict: "user_id,source,external_id" }).select("id, name, power_curve, power_histogram");
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const [a] = first.data as { id: string }[];
    const [b] = second.data as { id: string; name: string; power_curve: unknown; power_histogram: unknown }[];
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ name: "Renamed", power_curve: { "60": 300 }, power_histogram: [1, 2, 3] });
  });

  it("filters, orders, embeds and counts", async () => {
    await supabase.from("activities").insert([
      { source: "app", external_id: "1", started_at: "2026-11-01T10:00:00Z", duration_seconds: 60 },
      { source: "app", external_id: "2", started_at: "2026-11-02T10:00:00Z", duration_seconds: 120, intervals_id: "i2" },
    ]);
    const { data: rides } = await supabase.from("activities").select("id, external_id").not("intervals_id", "is", null);
    expect(rides).toEqual([{ id: expect.any(String), external_id: "2" }]);
    const id = (rides as { id: string }[])[0].id;
    await supabase.from("ride_feedback").insert({ activity_id: id, difficulty: "right", rpe: 6 });
    const { data: fb } = await supabase.from("ride_feedback").select("activity_id, difficulty, activities(duplicate_of)");
    expect(fb).toEqual([{ activity_id: id, difficulty: "right", activities: { duplicate_of: null } }]);
    const { data: ordered } = await supabase.from("activities").select("external_id").gte("started_at", new Date("2026-10-01").toISOString()).order("started_at", { ascending: false }).limit(1);
    expect(ordered).toEqual([{ external_id: "2" }]);
    const { count } = await supabase.from("activities").select("id", { count: "exact", head: true });
    expect(count).toBe(2);
  });

  it("matches JSON with contains, and maybeSingle gives null when nothing matches", async () => {
    await supabase.from("coach_messages").insert({ role: "assistant", content: "hi", meta: { reviewOf: "2026-11-02", plannedWeek: true } });
    const hit = await supabase.from("coach_messages").select("content").contains("meta", { reviewOf: "2026-11-02" }).limit(1);
    const bool = await supabase.from("coach_messages").select("content").contains("meta", { plannedWeek: true });
    const miss = await supabase.from("coach_messages").select("content").contains("meta", { reviewOf: "2026-10-26" }).maybeSingle();
    expect(hit.data).toEqual([{ content: "hi" }]);
    expect(bool.data).toEqual([{ content: "hi" }]);
    expect(miss).toMatchObject({ data: null, error: null });
  });

  it("updates and deletes with filters, and reports unique violations as Postgres does", async () => {
    await supabase.from("plan_days").upsert({ day: "2026-11-07", feel_after: 3 }, { onConflict: "user_id,day" });
    await supabase.from("plan_days").update({ feel_after: 4 }).eq("day", "2026-11-07");
    const { data } = await supabase.from("plan_days").select("day, feel_after").eq("day", "2026-11-07").single();
    expect(data).toEqual({ day: "2026-11-07", feel_after: 4 });
    await supabase.from("plan_days").delete().match({ day: "2026-11-07" });
    const { data: none } = await supabase.from("plan_days").select("day");
    expect(none).toEqual([]);
    await supabase.from("body_measurements").insert({ measured_at: "2026-11-07T07:00:00Z", weight_kg: 70 });
    const dup = await supabase.from("body_measurements").insert({ measured_at: "2026-11-07T07:00:00.000Z", weight_kg: 71 });
    expect(dup.error?.code).toBe("23505");
  });

  it("knows the local rider", async () => {
    const { data } = await supabase.auth.getClaims();
    expect(data.claims.sub).toBe(LOCAL_USER);
  });
});
