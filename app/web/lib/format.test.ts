import { describe, expect, it } from "vitest";
import { sourceLabel } from "./format";

describe("sourceLabel", () => {
  it("names ride sources the way riders write them", () => {
    expect(sourceLabel("zwift")).toBe("Zwift");
    expect(sourceLabel("zwift_fit")).toBe("Zwift file");
    expect(sourceLabel("karoo_fit")).toBe("Karoo file");
    expect(sourceLabel("strava")).toBe("Strava");
    expect(sourceLabel("intervals")).toBe("intervals.icu");
    expect(sourceLabel("app")).toBe("This app");
  });
  it("capitalizes sources it doesn't know, keeping brand spellings", () => {
    expect(sourceLabel("garmin")).toBe("Garmin");
    expect(sourceLabel("wahoo_fit")).toBe("Wahoo file");
    expect(sourceLabel("lactic")).toBe("Lactic");
    expect(sourceLabel("rouvy")).toBe("Rouvy");
    expect(sourceLabel("bike_computer")).toBe("Bike computer");
  });
});
