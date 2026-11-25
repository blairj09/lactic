import { describe, expect, it } from "vitest";
import { hrRecovery, recoveryAgainstUsual, usualHrRecovery } from "./hr-recovery";

const STEP = 5;
/** A 5 s stream from [seconds, watts, start hr, end hr] blocks, heart rate moving linearly within each. */
function stream(blocks: [number, number, number, number][]) {
  const watts: number[] = [];
  const heartRate: number[] = [];
  for (const [seconds, w, from, to] of blocks) {
    const n = seconds / STEP;
    for (let i = 0; i < n; i++) {
      watts.push(w);
      heartRate.push(Math.round(from + ((to - from) * i) / Math.max(1, n - 1)));
    }
  }
  return { step: STEP, watts, heartRate };
}

describe("hrRecovery", () => {
  it("reads the drop in the minute after each hard effort", () => {
    const s = stream([
      [300, 150, 110, 120],
      [240, 280, 140, 170],
      [60, 120, 168, 140],
      [120, 120, 138, 120],
      [240, 285, 145, 174],
      [60, 110, 172, 150],
      [120, 110, 148, 125],
    ]);
    const r = hrRecovery(s, 280)!;
    expect(r.efforts).toHaveLength(2);
    expect(r.efforts[0]).toMatchObject({ from: 300, to: 540, watts: 280, peak: 170 });
    expect(r.efforts[0].drop).toBeGreaterThanOrEqual(28);
    expect(r.efforts[1].peak).toBe(174);
    expect(r.drop).toBe(Math.round((r.efforts[0].drop + r.efforts[1].drop) / 2));
  });

  it("skips efforts that are too short, or not followed by easy riding", () => {
    const s = stream([
      [300, 150, 110, 120],
      [30, 400, 140, 160],
      [120, 120, 150, 120],
      [240, 280, 140, 170],
      [120, 240, 168, 160],
    ]);
    expect(hrRecovery(s, 280)).toBeNull();
  });

  it("skips an effort the ride ends in", () => {
    expect(hrRecovery(stream([[300, 150, 110, 120], [240, 280, 140, 170], [30, 100, 165, 150]]), 280)).toBeNull();
  });

  it("bridges short dips inside an effort", () => {
    const s = stream([
      [300, 150, 110, 120],
      [120, 280, 140, 160],
      [10, 150, 160, 158],
      [120, 280, 158, 170],
      [180, 100, 168, 120],
    ]);
    expect(hrRecovery(s, 280)!.efforts).toHaveLength(1);
  });

  it("needs FTP, power and heart rate", () => {
    const s = stream([[300, 150, 110, 120], [240, 280, 140, 170], [120, 110, 168, 130]]);
    expect(hrRecovery(s, null)).toBeNull();
    expect(hrRecovery({ ...s, heartRate: null }, 280)).toBeNull();
    expect(hrRecovery({ ...s, watts: null }, 280)).toBeNull();
    expect(hrRecovery({ ...s, heartRate: s.heartRate.map(() => 0) }, 280)).toBeNull();
  });
});

describe("usualHrRecovery", () => {
  it("is the median of earlier rides, once there are enough", () => {
    expect(usualHrRecovery([30, 20])).toBeNull();
    expect(usualHrRecovery([30, 20, 25])).toEqual({ drop: 25, rides: 3 });
    expect(usualHrRecovery([30, 20, 25, 27])).toEqual({ drop: 26, rides: 4 });
  });

  it("calls a few beats either way the same", () => {
    const usual = { drop: 30, rides: 5 };
    expect(recoveryAgainstUsual(33, usual)).toBe("usual");
    expect(recoveryAgainstUsual(35, usual)).toBe("faster");
    expect(recoveryAgainstUsual(24, usual)).toBe("slower");
    expect(recoveryAgainstUsual(24, null)).toBeNull();
  });
});
