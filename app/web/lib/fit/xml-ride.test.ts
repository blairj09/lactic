import { describe, expect, it } from "vitest";
import { rideFromFile } from "./ride";

const enc = (s: string) => new TextEncoder().encode(s);
const tcxPoint = (i: number, watts: number) =>
  `<Trackpoint><Time>2026-11-01T10:00:${String(i).padStart(2, "0")}Z</Time><DistanceMeters>${i * 8}</DistanceMeters><HeartRateBpm><Value>${130 + i}</Value></HeartRateBpm><Cadence>90</Cadence><Extensions><ns3:TPX><ns3:Watts>${watts}</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
const tcx = (sport: string) =>
  `<?xml version="1.0"?><TrainingCenterDatabase xmlns="x"><Activities><Activity Sport="${sport}"><Id>2026-11-01T10:00:00Z</Id><Lap><Track>${Array.from({ length: 30 }, (_, i) => tcxPoint(i, 200)).join("")}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;

const gpx = `<gpx version="1.1"><trk><name>Morning &amp; ride</name><type>cycling</type><trkseg>${Array.from(
  { length: 30 },
  (_, i) =>
    `<trkpt lat="40.${i}" lon="-111.${i}"><ele>1500</ele><time>2026-11-02T07:00:${String(i).padStart(2, "0")}Z</time><extensions><power>250</power><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`,
).join("")}</trkseg></trk></gpx>`;

describe("GPX and TCX rides", () => {
  it("reads an indoor TCX ride without positions", () => {
    const ride = rideFromFile(enc(tcx("Biking")), "trainer.tcx");
    expect(ride).not.toBeNull();
    expect(ride!.name).toBe("trainer");
    expect(ride!.startedAt).toBe("2026-11-01T10:00:00.000Z");
    expect(ride!.distanceMeters).toBe(232);
    expect(ride!.stream.route).toBeNull();
    expect(ride!.summary.durationSeconds).toBeGreaterThanOrEqual(29);
  });

  it("skips a TCX run", () => {
    expect(rideFromFile(enc(tcx("Running")), "run.tcx")).toBeNull();
  });

  it("reads a GPX ride with power, heart rate, cadence and a route", () => {
    const ride = rideFromFile(enc(gpx), "123.gpx.gz");
    expect(ride!.name).toBe("Morning & ride");
    expect(ride!.startedAt).toBe("2026-11-02T07:00:00.000Z");
    expect(ride!.stream.route?.length).toBeGreaterThan(1);
  });

  it("rejects other files", () => {
    expect(() => rideFromFile(enc("hello"), "x.gpx")).toThrow(/Not a FIT, GPX or TCX/);
  });
});
