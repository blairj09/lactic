import { describe, expect, it } from "vitest";
import { encodeRideFit } from "@shared/fit/encode";
import { decodeFit } from "@shared/fit/decode";
import { handoffScheme, handoffUrl, readHandoff } from "./handoff";

const seconds = 30 * 60;
const fit = encodeRideFit({
  startedAt: new Date("2026-11-18T17:00:00Z"),
  watts: Array.from({ length: seconds }, (_, i) => 150 + (i % 60)),
  heartRate: Array.from({ length: seconds }, () => 140),
  cadence: Array.from({ length: seconds }, () => 90),
});

describe("test drive handoff", () => {
  it("carries the FTP and the ride through the link", () => {
    const url = handoffUrl({ ftp: 245, method: "rampTest", ride: { name: "Ramp test", fit } });
    expect(url.startsWith("lactic://lactic.fit/test-drive?ftp=245&method=rampTest")).toBe(true);
    // A half-hour ride fits easily in a link.
    expect(url.length).toBeLessThan(40_000);
    const back = readHandoff(url)!;
    expect(back.ftp).toBe(245);
    expect(back.method).toBe("rampTest");
    expect(back.ride?.name).toBe("Ramp test");
    expect(back.ride?.fit).toEqual(fit);
    expect(decodeFit(back.ride!.fit).records.length).toBe(seconds);
  });

  it("carries just the FTP for a simulated ride", () => {
    const back = readHandoff(handoffUrl({ ftp: 210, method: "manual", ride: null }, "lactic-preview"))!;
    expect(back).toEqual({ ftp: 210, method: "manual", ride: null });
  });

  it("turns away links that aren't a handoff or don't hold up", () => {
    expect(readHandoff("lactic://lactic.fit/strava?code=1")).toBeNull();
    expect(readHandoff("https://lactic.fit/test-drive?ftp=245")).toBeNull();
    expect(readHandoff("lactic://evil.example/test-drive?ftp=245")).toBeNull();
    expect(readHandoff("lactic://lactic.fit/test-drive?ftp=9000")).toBeNull();
    expect(readHandoff("lactic://lactic.fit/test-drive?ftp=24.5")).toBeNull();
    expect(readHandoff("not a link")).toBeNull();
    // A broken ride still hands over the FTP.
    expect(readHandoff("lactic://lactic.fit/test-drive?ftp=245&method=sudo&fit=%%%")).toEqual({ ftp: 245, method: "manual", ride: null });
  });

  it("picks the Preview build's scheme from ?app=preview", () => {
    expect(handoffScheme("?app=preview")).toBe("lactic-preview");
    expect(handoffScheme("")).toBe("lactic");
  });
});
