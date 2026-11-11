import { describe, expect, it } from "vitest";
import { templatesFor } from "@/lib/engine/templates";
import { ZONES } from "@/lib/engine/library";
import { styleName } from "./ride-now";

describe("styleName", () => {
  it("drops the type the Type menu already shows", () => {
    expect(styleName("Threshold intervals", "threshold")).toBe("Intervals");
    expect(styleName("Threshold with hard starts", "threshold")).toBe("Hard starts");
    expect(styleName("Sweet spot over-unders", "sweetSpot")).toBe("Over-unders");
    expect(styleName("Over-unders", "threshold")).toBe("Over-unders");
  });

  it("keeps a name that would read as another type", () => {
    expect(styleName("Endurance with tempo", "endurance")).toBe("Endurance with tempo");
  });

  it("gives every zone's styles distinct names", () => {
    for (const zone of ZONES) {
      const names = templatesFor(zone).map((t) => styleName(t.name, zone));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
