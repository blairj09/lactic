import { describe, expect, it } from "vitest";
import { experiments, parseExperiments, setCurrentExperiments } from "./experiments";

describe("experimental features", () => {
  it("are off unless saved as on", () => {
    expect(parseExperiments(undefined)).toEqual({ race_report: false });
    expect(parseExperiments({ race_report: "yes" })).toEqual({ race_report: false });
    expect(parseExperiments({ race_report: true })).toEqual({ race_report: true });
  });

  it("keeps the current choice for screens to read", () => {
    setCurrentExperiments({ race_report: true });
    expect(experiments().race_report).toBe(true);
    setCurrentExperiments({ race_report: false });
    expect(experiments().race_report).toBe(false);
  });
});
