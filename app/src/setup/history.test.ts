import { describe, expect, it } from "vitest";
import { STRAVA_ARCHIVE } from "./history";

describe("Strava archive in Downloads", () => {
  it("matches Strava's export file and its re-downloads", () => {
    expect(STRAVA_ARCHIVE.test("export_12345678.zip")).toBe(true);
    expect(STRAVA_ARCHIVE.test("export_12345678 (1).zip")).toBe(true);
  });
  it("leaves other zips alone", () => {
    expect(STRAVA_ARCHIVE.test("garmin_export.zip")).toBe(false);
    expect(STRAVA_ARCHIVE.test("export_.zip")).toBe(false);
    expect(STRAVA_ARCHIVE.test("export_123.fit")).toBe(false);
  });
});
