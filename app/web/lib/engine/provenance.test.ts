import { describe, expect, it } from "vitest";
import { describeProvenance, ftpProvenance, ftpSourceLine, nightProvenance, weightProvenance } from "./provenance";

describe("where a number came from", () => {
  it("labels FTP by how it was set", () => {
    const history = [
      { effectiveDate: "2026-09-01", watts: 250, method: "rampTest" },
      { effectiveDate: "2026-10-20", watts: 258, method: "criticalPower" },
    ];
    expect(ftpProvenance(history, "2026-10-01")).toEqual({ kind: "measured", date: "2026-09-01", via: "ramp test" });
    expect(ftpProvenance(history, "2026-11-08")?.kind).toBe("estimated");
    expect(ftpProvenance([], "2026-11-08")).toBeNull();
    expect(ftpSourceLine(history, "2026-10-20")).toBe("Estimated today · critical power from your rides");
  });

  it("tells a scale from a synced weigh-in", () => {
    expect(weightProvenance("body_pod", "2026-11-08").kind).toBe("measured");
    expect(weightProvenance("intervals", "2026-11-08")).toEqual({ kind: "synced", date: "2026-11-08", via: "intervals.icu" });
  });

  it("marks nights as synced from their app", () => {
    expect(nightProvenance("shortcut", "2026-11-08").via).toBe("Apple Health");
    expect(describeProvenance(nightProvenance("intervals", "2026-11-03"), "2026-11-08")).toBe("Synced Nov 3 · intervals.icu");
  });
});

describe("setup's FTP guess", () => {
  it("is an estimate, not a measurement", () => {
    expect(ftpProvenance([{ effectiveDate: "2026-11-01", watts: 185, method: "guess" }], "2026-11-08")).toEqual({ kind: "estimated", date: "2026-11-01", via: "a starting guess from your weight" });
  });
});
