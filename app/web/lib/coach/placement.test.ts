import { describe, expect, it } from "vitest";
import { withoutPlacement } from "./placement";

describe("withoutPlacement", () => {
  it("drops pointers at the page", () => {
    expect(withoutPlacement("Take the shorter 45-minute version under this brief.")).toBe("Take the shorter 45-minute version.");
    expect(withoutPlacement("Take the level-easier version under this, since sleep was short.")).toBe("Take the level-easier version, since sleep was short.");
    expect(withoutPlacement("Choose the easier option below.")).toBe("Choose the easier option.");
    expect(withoutPlacement("The options above and the change to Thursday both help.")).toBe("The options and the change to Thursday both help.");
    expect(withoutPlacement("I've suggested a swap (see below).")).toBe("I've suggested a swap.");
    expect(withoutPlacement("Ride the Suggested workout shown above the brief, then rest.")).toBe("Ride the Suggested workout, then rest.");
    expect(withoutPlacement("Accept the change with the button below.")).toBe("Accept the change with the button.");
  });

  it("keeps training language", () => {
    for (const t of [
      "Keep the endurance ride below 75% of FTP.",
      "Stay under 200 W on the climbs and above 85 rpm.",
      "HRV is below your usual range, and sleep was under 6 hours.",
      "Hold just below threshold for the over-unders.",
      "Under this much fatigue, take the 45-minute version.",
    ]) expect(withoutPlacement(t)).toBe(t);
  });
});
