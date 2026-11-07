import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { simBackend, simRider } from "~/bluetooth/sim";
import { workoutDuration } from "@/lib/engine/workout";
import { connectDemoGear, DEMO_WORKOUT, type DemoReading } from "./demo";

describe("demo ride", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is short", () => {
    expect(workoutDuration(DEMO_WORKOUT)).toBeLessThanOrEqual(180);
  });

  it("holds the ERG target on the simulated trainer, whatever the cadence", async () => {
    const backend = simBackend();
    const last: Partial<DemoReading> = {};
    const connecting = connectDemoGear(backend, (r) => Object.assign(last, r));
    await vi.advanceTimersByTimeAsync(1000);
    const gear = await connecting;
    await gear.setTarget(250);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(last.watts).toBeGreaterThan(235);
    expect(last.watts).toBeLessThan(265);
    expect(last.heartRate).toBeGreaterThan(60);
    expect(last.cadence).toBeGreaterThan(80);

    const cadence = simRider.cadence;
    simRider.cadence = 70;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(last.watts).toBeGreaterThan(235);
    expect(last.cadence).toBeLessThan(75);
    simRider.cadence = cadence;

    await gear.stop();
  });
});
