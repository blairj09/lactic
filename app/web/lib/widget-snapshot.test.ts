import { describe, expect, it } from "vitest";
import { athlete, TODAY } from "../../evals/athlete";
import { widgetSnapshot } from "./widget-snapshot";

describe("widgetSnapshot", () => {
  it("words last night and today's ride for the widget", () => {
    const { state } = athlete({ recovery: { hrv: 52, restingHr: 49, sleepHours: 7.5, score: 72, reasons: ["HRV 8% above your normal"] } });
    const s = widgetSnapshot(state, null, new Date("2026-10-29T14:00:00Z"));
    expect(s.day).toBe(TODAY);
    expect(s.recovery).toMatchObject({ score: 72, word: "Recovered", reason: "HRV 8% above your normal" });
    expect(s.today.state).toMatch(/planned|rest/);
    if (s.today.state === "planned") expect(s.today.detail).toMatch(/^\d+ min · /);
  });

  it("says the baseline is still building", () => {
    const { state } = athlete({ recovery: { hrv: 52, restingHr: 49, sleepHours: 7.5, score: null, baselineDays: 9 } });
    const s = widgetSnapshot(state, null);
    expect(s.recovery).toMatchObject({ score: null, word: null, reason: "Building your baseline: 9 of 14 nights" });
  });

  it("rounds exertion and keeps the planned landing", () => {
    const { state } = athlete();
    const s = widgetSnapshot(state, { soFar: 1.234, rideTrimp: 0, offBikeTrimp: 10, target: { low: 3.44, high: 4.46 }, planned: { add: 2.5, landsAt: 3.77 } });
    expect(s.exertion).toEqual({ soFar: 1.2, low: 3.4, high: 4.5, landsAt: 3.8 });
  });

  it("says a ride is done", () => {
    const { state } = athlete({ extraRides: [{ name: "Morning spin", durationSeconds: 3600, startedAt: new Date("2026-10-29T16:00:00Z") }] });
    expect(widgetSnapshot(state, null).today).toEqual({ title: "Ride done", detail: "60 min · 50 TSS", state: "done", stress: 50, step: null });
  });

  it("adds tomorrow, the week and whether recovery is tracked", () => {
    const { state } = athlete();
    const s = widgetSnapshot(state, null, new Date("2026-10-29T14:00:00Z"), false);
    expect(s.recoveryTracked).toBe(false);
    expect(s.tomorrow?.state).toMatch(/planned|rest|event/);
    if (s.tomorrow?.state === "planned") {
      expect(s.tomorrow.step).toBeGreaterThanOrEqual(1);
      expect(s.tomorrow.stress).toBeGreaterThan(0);
    }
    expect(s.week?.days.map((d) => d.label)).toEqual(["M", "T", "W", "T", "F", "S", "S"]);
    expect(s.week?.days.filter((d) => d.today)).toHaveLength(1);
    expect(s.week!.rides.done).toBeLessThanOrEqual(s.week!.rides.planned);
    expect(s.week!.time.share).toBeGreaterThanOrEqual(0);
    expect(s.week!.time.share).toBeLessThanOrEqual(1);
  });

  it("marks today's ride done in the week", () => {
    const { state } = athlete({ extraRides: [{ name: "Morning spin", durationSeconds: 3600, startedAt: new Date("2026-10-29T16:00:00Z") }] });
    const today = widgetSnapshot(state, null).week?.days.find((d) => d.today);
    expect(today?.state).toMatch(/done|partial/);
  });
});
