import { describe, expect, it } from "vitest";
import { templatesFor } from "@/lib/engine/templates";
import { STARTING_LEVELS, ZONES } from "@/lib/engine/library";
import { WORKOUT_LIBRARY } from "@/lib/engine/workout-library";
import type { CustomWorkout } from "@/lib/custom-workouts";
import { lengthFor, librarySession, matchingWorkouts, styleName, type LibraryChoice, type LibraryKind } from "./ride-now";

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

describe("matchingWorkouts", () => {
  const levels = { ...STARTING_LEVELS };
  const choice = (kind: LibraryKind, minutes: number): LibraryChoice => ({ kind, minutes, shift: 0 });

  it("lists only workouts of the type, near the length", () => {
    for (const kind of ZONES) {
      for (const minutes of [30, 45, 60, 90]) {
        for (const m of matchingWorkouts(choice(kind, minutes), levels, [])) {
          expect(lengthFor(m.duration)).toBe(minutes);
          if ("library" in m.pick) expect(librarySession(m.pick.library, levels).zone).toBe(kind);
          if ("starter" in m.pick) expect(m.pick.starter.zone).toBe(kind);
        }
      }
    }
  });

  it("leaves out styles the engine can't fit, instead of another type", () => {
    // 30 minutes is too short for tempo: the engine would build endurance.
    const tempo30 = matchingWorkouts(choice("tempo", 30), levels, []);
    expect(tempo30.every((m) => !m.name.startsWith("Endurance"))).toBe(true);
    expect(matchingWorkouts(choice("tempo", 60), levels, []).length).toBeGreaterThan(3);
  });

  it("puts the FTP tests under FTP test", () => {
    const names = matchingWorkouts(choice("rampTest", 60), levels, []).map((m) => m.name);
    expect(names).toContain("Ramp test");
    expect(names).toContain("20-minute FTP test");
  });

  it("includes My workouts that fit", () => {
    const tempo = WORKOUT_LIBRARY.find((w) => w.zone === "tempo" && lengthFor(w.duration) === 60)!;
    const saved = [{ id: "mine", workout: { ...tempo.workout, name: "My tempo" } }] as unknown as CustomWorkout[];
    const m = matchingWorkouts(choice("tempo", 60), levels, saved).find((x) => x.name === "My tempo");
    expect(m?.saved).toBe(true);
  });
});
