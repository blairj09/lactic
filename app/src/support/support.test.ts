// The coach's app tools: what they show, what they refuse while riding, and settings changes going
// through Apply like plan changes. Runs against an in-memory database with stand-ins for browser storage.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  window: Object.assign(new EventTarget(), { dispatchEvent: () => true }),
});

const { openSqlJs } = await import("~/db/sqljs");
const { setSql } = await import("~/db/sql");
const { migrate } = await import("~/db/migrate");
const { localClient } = await import("~/db/supabase-client");
const { applyChange } = await import("@/app/coach/actions");
const { checkAppSetting, describeAppSetting } = await import("@/lib/coach/app-tools");
const { coachSetup } = await import("~/ai/settings");
const { setLiveRide } = await import("@/lib/live-ride");
const { callTool, mcpTools } = await import("~/mcp/bridge");
const { installSupportTools, runSupportTool } = await import("./tools");
const { clearLog, logEvent, recentEvents, scrub } = await import("./log");

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
  await localClient.from("athlete_settings").upsert({ ftp_watts: 250, timezone: "UTC", weight_kg: 72 });
  installSupportTools();
});

beforeEach(() => {
  clearLog();
  setLiveRide(null);
});

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe("activity log", () => {
  it("strips keys and tokens", () => {
    expect(scrub("Authorization: Bearer sk-or-v1-abc123def456ghi789jkl012")).not.toContain("abc123");
    expect(scrub("api_key=Zq8x7Lm2Np4Rt6Vw9Ys1Bc3Df5")).toBe("api_key=•••");
    expect(scrub("Basic QVBJX0tFWTpzZWNyZXQ=")).toBe("Basic •••");
    expect(scrub("token 4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a")).not.toMatch(/4f9a8b7c/);
    expect(scrub("KICKR CORE 1A2B dropped the connection")).toBe("KICKR CORE 1A2B dropped the connection");
  });

  it("keeps the newest events, filtered by area", () => {
    logEvent("bluetooth", "warn", "KICKR dropped the connection");
    logEvent("intervals", "error", "Sync failed: intervals.icu didn't accept the API key.");
    expect(recentEvents({ area: "intervals" }).map((e) => e.message)).toEqual(["Sync failed: intervals.icu didn't accept the API key."]);
    expect(recentEvents()).toHaveLength(2);
  });
});

describe("settings the coach can propose", () => {
  it("checks what the model sent", () => {
    expect(checkAppSetting({ setting: "power_source", value: "trainer" })).toEqual({ setting: "power_source", value: "trainer" });
    expect(() => checkAppSetting({ setting: "power_source", value: "pedals" })).toThrow(/trainer or powerMeter/);
    expect(() => checkAppSetting({ setting: "forget_device", device: "toaster" })).toThrow(/device is one of/);
    expect(() => checkAppSetting({ setting: "delete_rides" })).toThrow(/setting is one of/);
    expect(describeAppSetting({ setting: "rename_device", device: "trainer", name: "Kicker" })).toBe('Call the trainer "Kicker"');
  });

  it("goes through Apply over MCP, like plan changes", async () => {
    const r = await callTool("propose_app_change", { setting: "power_source", value: "powerMeter", reason: "Pedals read truer" });
    expect(textOf(r)).toContain("Apply");
    expect(store.get("ride.powerSource")).toBeUndefined();
    const { data } = await localClient.from("coach_proposals").select("*");
    const row = (data as { proposal: { change: { kind: string }; summary: string } }[]).at(-1)!;
    expect(row.proposal.change.kind).toBe("app");
    expect(row.proposal.summary).toBe("Power source: power meter (now trainer)");
    expect(await applyChange(localClient as never, row.proposal.change as never)).toBe("Done: Power source: power meter.");
    expect(store.get("ride.powerSource")).toBe("powerMeter");
    expect(recentEvents({ area: "coach" }).at(-1)?.message).toBe("Applied: Power source: power meter");
  });

  it("changes profile numbers through Apply, within Settings' limits", async () => {
    expect(() => checkAppSetting({ setting: "profile", field: "max_hr", value: 300 })).toThrow(/between 100 and 240/);
    expect(() => checkAppSetting({ setting: "profile", field: "birth_date", value: 1990 })).toThrow(/looks like 1990-05-31/);
    expect(() => checkAppSetting({ setting: "profile", field: "resting_hr", value: 50 })).toThrow(/field is one of/);
    expect(checkAppSetting({ setting: "profile", field: "weight_kg", value: "71.04" })).toEqual({ setting: "profile", field: "weight_kg", value: 71 });

    const proposed = JSON.parse((await runSupportTool("propose_app_change", { setting: "profile", field: "max_hr", value: 188, reason: "From your race" })).content);
    expect(proposed.proposed).toBe("Max heart rate: 188 bpm (now not set)");
    const read = async () => (await localClient.from("athlete_settings").select("*").maybeSingle()).data as Record<string, unknown>;
    expect((await read()).max_hr ?? null).toBeNull();
    expect(await applyChange(localClient as never, { kind: "app", setting: { setting: "profile", field: "max_hr", value: 188 } })).toBe("Done: Max heart rate: 188 bpm.");
    expect((await read()).max_hr).toBe(188);
    expect((await read()).ftp_watts).toBe(250);

    expect(() => checkAppSetting({ setting: "profile", field: "timezone", value: "Mars/Olympus" })).toThrow(/Unknown time zone/);
    expect(() => checkAppSetting({ setting: "profile", field: "sex", value: "x" })).toThrow(/male, female/);
    await applyChange(localClient as never, { kind: "app", setting: checkAppSetting({ setting: "profile", field: "timezone", value: "America/Denver" }) });
    expect((await read()).timezone).toBe("America/Denver");
  });

  it("changes the coach's voice, mode and AI limit through Apply", async () => {
    expect(() => checkAppSetting({ setting: "coach_voice", voice: { tone: "grumpy" } })).toThrow(/tone is one of/);
    const voice = checkAppSetting({ setting: "coach_voice", voice: { tone: "calm", detail: "brief" } });
    expect(describeAppSetting(voice)).toBe("How the coach talks: tone Calm, detail Brief");
    await applyChange(localClient as never, { kind: "app", setting: voice });
    const { data: persona } = await localClient.from("coach_persona").select("*").maybeSingle();
    expect(persona).toMatchObject({ name: "Coach", tone: "calm", detail: "brief" });

    await applyChange(localClient as never, { kind: "app", setting: checkAppSetting({ setting: "ai_limit", value: 25 }) });
    expect((await coachSetup()).monthlyCapUsd).toBe(25);
    await applyChange(localClient as never, { kind: "app", setting: checkAppSetting({ setting: "ai_limit", value: null }) });
    expect((await coachSetup()).monthlyCapUsd).toBeNull();

    await expect(applyChange(localClient as never, { kind: "app", setting: { setting: "coach_mode", value: "builtin" } })).rejects.toThrow(/provider and a model/);
    expect((await runSupportTool("propose_app_change", { setting: "coach_model", value: "x/y", reason: "r" })).content).toMatch(/No AI provider/);
    expect(() => checkAppSetting({ setting: "api_key", value: "sk-123" })).toThrow(/setting is one of/);
  });
});

describe("app tools", () => {
  it("are offered over MCP", () => {
    const names = mcpTools().map((t) => t.name);
    for (const n of ["check_app", "test_connection", "sync_now", "reconnect_device", "scan_for_devices", "propose_app_change", "set_appearance"]) expect(names).toContain(n);
  });

  it("report on the app without keys", async () => {
    await localClient.from("intervals_connections").upsert({ user_id: "local", athlete_id: "i123", api_key: "keychain:intervals", connected_at: new Date().toISOString() }, { onConflict: "user_id" });
    logEvent("intervals", "error", "Sync failed: intervals.icu didn't accept the API key.");
    const report = JSON.parse(textOf(await callTool("check_app", {})));
    expect(report.intervals.connected).toBe(true);
    expect(report.bluetooth.paired.trainer).toBe("not paired");
    expect(report.activityLog.join("\n")).toContain("didn't accept the API key");
    expect(report.guide.bluetooth.join(" ")).toContain("Zwift");
    expect(JSON.stringify(report)).not.toContain("keychain:intervals");
  });

  it("only look while a ride is under way", async () => {
    setLiveRide({ hub: { getState: () => ({ links: {}, trainerStatus: "ERG", powerSource: "trainer" }) } as never, riding: true });
    expect((await runSupportTool("sync_now", { service: "intervals" })).content).toMatch(/^Error: A ride is under way/);
    expect((await runSupportTool("propose_app_change", { setting: "upload_rides", value: true, reason: "x" })).content).toMatch(/^Error: A ride is under way/);
    const report = JSON.parse((await runSupportTool("check_app", { area: "bluetooth" })).content);
    expect(report.riding).toBe(true);
    expect(report.bluetooth.rideScreen.trainer).toBe("ERG");
  });

  it("set the theme straight away, even mid-ride", async () => {
    const applied: string[] = [];
    Object.assign(window, { __applyTheme: (t: string) => applied.push(t) });
    setLiveRide({ hub: { getState: () => ({ links: {}, trainerStatus: "ERG", powerSource: "trainer" }) } as never, riding: true });
    const r = JSON.parse(textOf(await callTool("set_appearance", { theme: "light" })));
    expect(r).toMatchObject({ ok: true, theme: "light", was: "system" });
    expect(store.get("mycoach:theme")).toBe("light");
    expect(applied).toEqual(["light"]);
    await runSupportTool("set_appearance", { theme: "system" });
    expect(store.has("mycoach:theme")).toBe(false);
    expect((await runSupportTool("set_appearance", { theme: "pink" })).content).toMatch(/^Error: theme is light, dark or system/);
  });

  it("know how the app is laid out", async () => {
    const report = JSON.parse(textOf(await callTool("check_app", {})));
    expect(report.howLacticWorks).toContain("Appearance");
  });

  it("say when a device isn't paired", async () => {
    const r = JSON.parse((await runSupportTool("reconnect_device", { device: "heartRate" })).content);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("Settings → Bluetooth");
  });
});

describe("simulated gear", () => {
  it("is never offered as a change (it's a development switch)", async () => {
    expect(() => checkAppSetting({ setting: "simulated_gear", value: true })).toThrow(/setting is one of/);
    expect(JSON.stringify(mcpTools().find((t) => t.name === "propose_app_change"))).not.toContain("simulated");
  });
});
