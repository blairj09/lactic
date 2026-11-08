import { describe, expect, it } from "vitest";
import { features, parseFeatures, setCurrentFeatures } from "./features";
import { forFeatures, runTool, status, TOOLS, type CoachData } from "./coach/tools";
import { data as fixture } from "./coach/fixture";

describe("what the rider tracks", () => {
  it("keeps everything for riders from before the choice", () => {
    expect(parseFeatures(undefined)).toEqual({ recovery: true, weight: true });
    expect(parseFeatures({ weight: false })).toEqual({ recovery: true, weight: false });
    expect(parseFeatures({ recovery: "no", weight: false })).toEqual({ recovery: true, weight: false });
    expect(features()).toEqual({ recovery: true, weight: true });
    setCurrentFeatures({ recovery: false, weight: true });
    expect(features()).toEqual({ recovery: false, weight: true });
    setCurrentFeatures({ recovery: true, weight: true });
  });

  it("leaves the coach's tools for what isn't tracked out", () => {
    const names = (f: Parameters<typeof forFeatures>[1]) => forFeatures(TOOLS, f).map((t) => t.function.name);
    expect(names(undefined)).toContain("get_recovery");
    expect(names({ recovery: false, weight: true })).not.toContain("get_recovery");
    expect(names({ recovery: false, weight: true })).toContain("get_body");
    expect(names({ recovery: true, weight: false })).not.toContain("get_body");
  });

  it("tells the coach what's off and refuses its tools", () => {
    const data: CoachData = { ...fixture, features: { recovery: false, weight: false } };
    expect(runTool(data, "get_body", {}).content).toMatch(/doesn't track weight/);
    const s = status(data) as Record<string, unknown>;
    expect(s.notTracked).toMatch(/sleep and recovery or weight/);
    expect(s.recovery).toBeUndefined();
    expect(s.weighInToday).toBeUndefined();
    expect((status(fixture) as Record<string, unknown>).notTracked).toBeUndefined();
  });
});
