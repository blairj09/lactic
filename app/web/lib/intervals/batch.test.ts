import { describe, expect, it } from "vitest";
import { canImport, matchActivities, missingStravaRides, nextBatch, sameRide, stravaRides, type IntervalsActivity } from "./batch";

const a = (id: string, start: string, type = "Ride", source = "OAUTH_CLIENT"): IntervalsActivity => ({ id, start_date_local: start, type, source });

const listed = [
  a("i3", "2026-10-27T07:00:00"),
  a("i1", "2026-10-20T07:00:00", "VirtualRide", "ZWIFT"),
  a("i4", "2026-10-28T18:00:00", "Run"),
  a("i2", "2026-10-25T07:00:00", "Ride", "STRAVA"),
  a("i5", "2026-10-29T07:00:00"),
];

describe("intervals.icu batches", () => {
  it("walks forward oldest first, past the cursor only", () => {
    const first = nextBatch(listed, { after: "2026-10-20T07:00:00" }, 2);
    // i2 is taken (so the cursor moves past it) but skipped: Strava-sourced data isn't readable.
    expect(first.batch.map((x) => x.id)).toEqual(["i3"]);
    expect(first).toMatchObject({ cursor: "2026-10-27T07:00:00", more: true });
    const second = nextBatch(listed, { after: first.cursor! }, 2);
    expect(second.batch.map((x) => x.id)).toEqual(["i5"]);
    expect(second).toMatchObject({ cursor: "2026-10-29T07:00:00", more: false });
  });

  it("walks back newest first", () => {
    const back = nextBatch(listed, { before: "2026-10-29T07:00:00" }, 3);
    expect(back.batch.map((x) => x.id)).toEqual(["i3"]);
    expect(back).toMatchObject({ cursor: "2026-10-25T07:00:00", more: true });
  });

  it("returns no cursor when nothing is new", () => {
    expect(nextBatch(listed, { after: "2026-10-29T07:00:00" }, 5)).toEqual({ batch: [], cursor: null, more: false });
  });

  it("imports rides of any cycling type, not runs or Strava copies", () => {
    expect(listed.filter(canImport).map((x) => x.id)).toEqual(["i3", "i1", "i5"]);
  });

  it("counts the Strava rides it can't import", () => {
    expect(stravaRides([...listed, a("i6", "2026-10-26T07:00:00", "Run", "STRAVA")])).toBe(1);
  });
});

describe("linking rides to intervals.icu activities", () => {
  const act = (id: string, start: string, type = "Ride"): IntervalsActivity => ({ id, start_date_local: start.slice(0, 19), start_date: start, type });
  const ride = (id: string, start: string) => ({ id, startedAt: new Date(start) });

  it("pairs each ride with the activity that starts closest, within two minutes", () => {
    const links = matchActivities(
      [ride("r1", "2026-10-29T17:02:44Z"), ride("r2", "2026-10-28T12:00:00Z"), ride("r3", "2026-10-27T12:00:00Z")],
      [act("i1", "2026-10-29T17:02:45Z"), act("i2", "2026-10-28T12:01:30Z"), act("i3", "2026-10-27T12:05:00Z")],
    );
    expect([...links]).toEqual([
      ["r1", "i1"],
      ["r2", "i2"],
    ]);
  });

  it("uses an activity once, for the nearer of two rides", () => {
    const links = matchActivities([ride("far", "2026-10-29T17:01:00Z"), ride("near", "2026-10-29T17:02:40Z")], [act("i1", "2026-10-29T17:02:44Z")]);
    expect([...links]).toEqual([["near", "i1"]]);
  });

  it("skips runs and activities without a UTC start", () => {
    const links = matchActivities(
      [ride("r1", "2026-10-29T17:02:44Z")],
      [act("run", "2026-10-29T17:02:44Z", "Run"), { id: "i1", start_date_local: "2026-10-29T10:02:44", type: "Ride" }],
    );
    expect(links.size).toBe(0);
  });
});

describe("finding the same ride on intervals.icu", () => {
  const ride = { startedAt: new Date("2026-10-31T13:00:00Z"), durationSeconds: 3600 };
  const at = (id: string, start: string, elapsed: number | null, type = "VirtualRide", source = "ZWIFT"): IntervalsActivity => ({
    id,
    start_date_local: start.slice(0, 19),
    start_date: start,
    elapsed_time: elapsed,
    type,
    source,
  });

  it("finds Zwift's copy even when it started minutes earlier", () => {
    expect(sameRide(ride, [at("z", "2026-10-31T12:52:00Z", 4000)])?.id).toBe("z");
  });

  it("counts a ride that only reached intervals.icu through Strava", () => {
    expect(sameRide(ride, [at("s", "2026-10-31T13:01:00Z", 3500, "Ride", "STRAVA")])?.id).toBe("s");
  });

  it("ignores rides that barely touch it, other sports and other days", () => {
    const listed = [
      at("before", "2026-10-31T11:00:00Z", 7380), // ends 2 minutes into this one
      at("run", "2026-10-31T13:00:00Z", 3600, "Run"),
      at("yesterday", "2026-10-30T13:00:00Z", 3600),
    ];
    expect(sameRide(ride, listed)).toBeNull();
  });

  it("falls back to the start time when the length isn't listed", () => {
    expect(sameRide(ride, [at("near", "2026-10-31T13:05:00Z", null)])?.id).toBe("near");
    expect(sameRide(ride, [at("far", "2026-10-31T13:30:00Z", null)])).toBeNull();
  });
});

describe("Strava rides missing here", () => {
  const strava = (id: string, startUtc: string, type = "Ride"): IntervalsActivity => ({ id, start_date_local: startUtc.slice(0, 19), start_date: startUtc, type, source: "STRAVA", elapsed_time: 3600 });
  const stored = [{ startedAt: new Date("2026-10-31T13:00:00Z"), durationSeconds: 3600 }];

  it("lists Strava rides no stored ride covers, oldest first", () => {
    const listed = [strava("later", "2026-11-02T13:00:00Z"), strava("have", "2026-10-31T13:02:00Z"), strava("earlier", "2026-10-20T13:00:00Z")];
    expect(missingStravaRides(listed, stored).map((x) => x.id)).toEqual(["earlier", "later"]);
  });

  it("leaves out runs and rides from other sources", () => {
    expect(missingStravaRides([strava("run", "2026-11-02T13:00:00Z", "Run"), a("zwift", "2026-11-02T07:00:00", "VirtualRide", "ZWIFT")], stored)).toEqual([]);
  });

  it("matches on the local start when there's no UTC one", () => {
    const local = new Date("2026-11-03T08:00:00"); // read in this computer's zone, as the helper does
    const noUtc: IntervalsActivity = { id: "s", start_date_local: "2026-11-03T08:00:00", type: "Ride", source: "STRAVA", elapsed_time: 3600 };
    expect(missingStravaRides([noUtc], [{ startedAt: local, durationSeconds: 3600 }])).toEqual([]);
    expect(missingStravaRides([noUtc], stored)).toHaveLength(1);
  });
});
