import { describe, expect, it } from "vitest";
import { experiments, parseExperiments, setCurrentExperiments } from "./experiments";

describe("experimental features", () => {
  it("are off unless saved as on", () => {
    expect(parseExperiments(undefined)).toEqual({ race_report: false, strava_upload: false });
    expect(parseExperiments({ race_report: "yes" })).toEqual({ race_report: false, strava_upload: false });
    expect(parseExperiments({ race_report: true, strava_upload: true })).toEqual({ race_report: true, strava_upload: true });
  });

  it("keeps the current choice for screens to read", () => {
    setCurrentExperiments({ race_report: true, strava_upload: false });
    expect(experiments().race_report).toBe(true);
    setCurrentExperiments({ race_report: false, strava_upload: false });
    expect(experiments().race_report).toBe(false);
  });
});
