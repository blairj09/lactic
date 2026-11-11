// Rides recorded here on their way to Strava: queued when saved, uploaded with Lactic's title and
// description, checked on until Strava has the activity.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invoked: string[] = [];
vi.mock("~/platform/native", () => ({
  isDesktop: true,
  invoke: async (command: string) => {
    invoked.push(command);
    if (command === "strava_refresh" && refreshFails) throw "reconnect: Strava turned the sign-in down.";
  },
  openExternal: async () => {},
  isPhone: () => device !== "computer",
  os: () => (device === "computer" ? "macos" : "ios"),
}));
let refreshFails = false;
/** Which device the test runs as: a computer, an iPhone on its own, or one paired with a computer. */
let device: "computer" | "phone" | "paired" = "computer";
vi.mock("~/phone/plugin", () => ({
  phoneStatus: async () => ({ paired: device === "paired" ? { computer: "Mac", deviceId: "d", lastSentAt: null } : null }),
  webAuth: async () => ({ url: "" }),
}));
const synced: string[] = [];
vi.mock("~/phone/link", () => ({ syncWithComputer: async () => void synced.push("sync") }));
// The test runs the job itself; nothing in the background.
vi.mock("./background", () => ({ registerJob: () => {}, notifyChanged: () => {} }));

import { openSqlJs } from "~/db/sqljs";
import { setSql } from "~/db/sql";
import { migrate } from "~/db/migrate";
import { localClient } from "~/db/supabase-client";
import { setCurrentExperiments } from "@/lib/experiments";
import { connectStrava, disconnectStrava, loadStrava, postRideToStrava, queueStravaRide, readStravaReturn, recentStravaUploads, stravaUploadFor, syncStrava } from "./strava";

const RIDE = "00000000-0000-4000-8000-0000000000a1";
type Call = { url: string; form: FormData | null };
let calls: Call[] = [];
let replies: Response[] = [];

beforeAll(async () => {
  const db = await openSqlJs({ persist: false });
  await migrate(db);
  setSql(db);
});

beforeEach(async () => {
  setCurrentExperiments({ race_report: false, strava_upload: true, course_prep: false });
  refreshFails = false;
  device = "computer";
  synced.length = 0;
  calls = [];
  replies = [];
  invoked.length = 0;
  await localClient.from("strava_uploads").delete().neq("status", "");
  await localClient.from("activities").delete().neq("source", "");
  await localClient.from("strava_connections").delete().neq("athlete_id", "");
  await localClient
    .from("activities")
    .insert({ id: RIDE, source: "app", external_id: "2026-11-09T13:00:00.000Z", name: "Sweet Spot 3×12", started_at: "2026-11-09T13:00:00.000Z", duration_seconds: 4500, normalized_power: 241, training_stress: 82, intensity_factor: 0.86, average_hr: 148 });
  await localClient.from("strava_connections").insert({ athlete_id: "7", athlete_name: "J B" });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), form: init?.body instanceof FormData ? init.body : null });
    return replies.shift() ?? new Response("{}", { status: 500 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("posting rides to Strava", () => {
  it("uploads with Lactic's title and description, then picks up the activity once Strava has made it", async () => {
    await queueStravaRide(RIDE, new Uint8Array([1, 2, 3]));
    replies.push(json({ id: 99, id_str: "99", status: "Your activity is still being processed.", activity_id: null }, 201));
    const first = await syncStrava();
    expect(first).toMatchObject({ ok: true });
    expect(invoked).toContain("strava_refresh");
    expect(calls[0].url).toBe("https://www.strava.com/api/v3/uploads");
    const form = calls[0].form!;
    expect(form.get("name")).toBe("Sweet Spot 3×12");
    expect(String(form.get("description"))).toContain("NP 241 W · TSS 82");
    expect(String(form.get("description"))).toContain("Trained with Lactic");
    expect(form.get("trainer")).toBe("1");
    expect(form.get("data_type")).toBe("fit");
    expect((await recentStravaUploads())[0]).toMatchObject({ status: "processing" });

    replies.push(json({ id: 99, status: "Your activity is ready.", activity_id: 12345 }));
    await syncStrava();
    expect(calls[1].url).toBe("https://www.strava.com/api/v3/uploads/99");
    expect((await recentStravaUploads())[0]).toMatchObject({ status: "sent", stravaId: "12345", name: "Sweet Spot 3×12" });
  });

  it("skips a ride Strava already has", async () => {
    await queueStravaRide(RIDE, new Uint8Array([1]));
    replies.push(json({ id: 5, error: "ride.fit duplicate of <a href='/activities/777' target='_blank'>Morning Ride</a>", activity_id: null }));
    await syncStrava();
    expect((await recentStravaUploads())[0]).toMatchObject({ status: "skipped", stravaId: "777", error: "Already on Strava." });
  });

  it("keeps a ride waiting when Strava is down, and asks to reconnect when signed out", async () => {
    await queueStravaRide(RIDE, new Uint8Array([1]));
    replies.push(new Response("oops", { status: 503 }));
    await syncStrava();
    expect((await recentStravaUploads())[0]).toMatchObject({ status: "pending" });

    refreshFails = true;
    expect(await syncStrava()).toMatchObject({ ok: false });
    expect((await loadStrava())?.needsReconnect).toBe(true);
  });

  it("queues nothing with the experiment off or posting turned off", async () => {
    setCurrentExperiments({ race_report: false, strava_upload: false, course_prep: false });
    await queueStravaRide(RIDE, new Uint8Array([1]));
    setCurrentExperiments({ race_report: false, strava_upload: true, course_prep: false });
    await localClient.from("strava_connections").update({ upload_rides: false }).neq("athlete_id", "");
    await queueStravaRide(RIDE, new Uint8Array([1]));
    expect(await recentStravaUploads()).toEqual([]);
  });

  it("posts an earlier ride from its stored recording", async () => {
    await expect(postRideToStrava(RIDE)).rejects.toThrow(/no recording/);
    await localClient.from("activity_streams").insert({ activity_id: RIDE, step_seconds: 5, watts: [200, 210, 220], heart_rate: [140, 141, 142], cadence: [90, 90, 90] });
    await postRideToStrava(RIDE);
    expect(await stravaUploadFor(RIDE)).toMatchObject({ status: "pending" });
    replies.push(json({ id: 1, activity_id: 555 }, 201));
    await syncStrava();
    expect(await stravaUploadFor(RIDE)).toMatchObject({ status: "sent", stravaId: "555" });
    await localClient.from("activity_streams").delete().eq("activity_id", RIDE);
  });
});

describe("Strava on the iPhone", () => {
  it("posts from an iPhone used on its own", async () => {
    device = "phone";
    await queueStravaRide(RIDE, new Uint8Array([1]));
    replies.push(json({ id: 1, activity_id: 556 }, 201));
    await syncStrava();
    expect(await stravaUploadFor(RIDE)).toMatchObject({ status: "sent", stravaId: "556" });
  });

  it("leaves posting to the computer when paired, so a ride never goes twice", async () => {
    device = "paired";
    await queueStravaRide(RIDE, new Uint8Array([1]));
    await vi.waitFor(() => expect(synced).toEqual(["sync"]));
    expect(await syncStrava()).toBeUndefined();
    expect(invoked).not.toContain("strava_refresh");
    expect(calls).toEqual([]);
    // Still waiting, for the computer to send once it syncs; the phone hasn't marked the sign-in bad.
    expect(await stravaUploadFor(RIDE)).toMatchObject({ status: "pending" });
    expect((await loadStrava())?.needsReconnect).toBe(false);
    await expect(connectStrava()).rejects.toThrow(/on your computer/);
    await expect(disconnectStrava()).rejects.toThrow(/on your computer/);
  });

  it("reads the code from where Strava's sign-in sent the iPhone back", () => {
    expect(readStravaReturn("lactic://lactic.fit/strava?state=s1&code=abc123&scope=read,activity:write", "s1")).toEqual({ code: "abc123", scope: "read,activity:write" });
    expect(() => readStravaReturn("lactic://lactic.fit/strava?state=old&code=abc", "s1")).toThrow(/out of date/);
    expect(() => readStravaReturn("lactic://lactic.fit/strava?state=s1&error=access_denied", "s1")).toThrow(/didn't allow/);
    expect(() => readStravaReturn("lactic://lactic.fit/strava?state=s1", "s1")).toThrow(/didn't finish/);
  });
});
