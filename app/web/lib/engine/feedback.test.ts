import { describe, expect, it } from "vitest";
import { checkin } from "./checkin";
import { feedbackStrain, type RideAnswer } from "./feedback";
import { applyOutcomes } from "./levels";
import { buildSession, STARTING_LEVELS } from "./library";

const today = "2026-10-30";
const answer = (date: string, difficulty: RideAnswer["difficulty"], rpe: number | null = null): RideAnswer => ({ date, difficulty, rpe });

describe("post-ride survey and levels", () => {
  const start = { ...STARTING_LEVELS, threshold: 4 };
  const ride = { date: "2026-10-01", zone: "threshold" as const, level: 4.5, completion: 1 };

  it("moves the level by how the workout felt", () => {
    expect(applyOutcomes(start, [{ ...ride, difficulty: "tooEasy" }]).threshold).toBe(5.5);
    expect(applyOutcomes(start, [{ ...ride, difficulty: "right" }]).threshold).toBe(4.8);
    expect(applyOutcomes(start, [{ ...ride, difficulty: "right", rpe: 5 }]).threshold).toBe(5.1);
    expect(applyOutcomes(start, [{ ...ride, difficulty: "right", rpe: 9 }]).threshold).toBe(4.5);
    expect(applyOutcomes(start, [{ ...ride, difficulty: "tooHard" }]).threshold).toBe(4);
    expect(applyOutcomes(start, [{ ...ride, difficulty: "failed" }]).threshold).toBe(3.5);
  });

  it("wins over the older feel answer", () => {
    expect(applyOutcomes(start, [{ ...ride, feel: 1, difficulty: "tooHard" }]).threshold).toBe(4);
  });

  it("never raises the level for a ride that was too hard", () => {
    expect(applyOutcomes({ ...start, threshold: 3 }, [{ ...ride, difficulty: "tooHard" }]).threshold).toBe(3);
  });
});

describe("feedback strain", () => {
  it("is nothing without recent answers", () => {
    expect(feedbackStrain([], today)).toEqual({ strain: 0, reason: null });
    expect(feedbackStrain([answer("2026-10-10", "failed")], today).strain).toBe(0);
  });

  it("backs off after a workout you couldn't finish or a run of hard ones", () => {
    expect(feedbackStrain([answer("2026-10-29", "failed")], today).strain).toBe(1);
    expect(feedbackStrain([answer("2026-10-29", "tooHard"), answer("2026-10-28", "right"), answer("2026-10-27", "tooHard")], today).strain).toBe(1);
    expect(feedbackStrain([answer("2026-10-29", "tooHard"), answer("2026-10-28", "right")], today).strain).toBe(0);
  });

  it("pushes after two too easy in a row", () => {
    expect(feedbackStrain([answer("2026-10-29", "tooEasy"), answer("2026-10-27", "tooEasy")], today).strain).toBe(-1);
    expect(feedbackStrain([answer("2026-10-29", "tooEasy"), answer("2026-10-27", "right")], today).strain).toBe(0);
  });

  it("feeds the check-in", () => {
    const base = { planned: buildSession("threshold", 5, 3600), recovery: 40, form: -5, fitness: 60, feel: 3 as const };
    expect(checkin(base).recommended).toBe("asPlanned");
    const tired = checkin({ ...base, feedback: feedbackStrain([answer("2026-10-29", "failed")], today) });
    expect(tired.recommended).toBe("easier");
    expect(tired.reasons).toContain("You couldn't finish your last workout");
  });
});
