import { describe, expect, it } from "vitest";
import { exertionStatus } from "./exertion-status";

describe("exertionStatus", () => {
  const target = { low: 5, high: 7 };
  it("counts down to the target, then says reached or over", () => {
    expect(exertionStatus({ soFar: 3.6, target })).toEqual({ text: "1.4 to target", over: false });
    expect(exertionStatus({ soFar: 5, target })).toEqual({ text: "Target reached", over: false });
    expect(exertionStatus({ soFar: 7, target })).toEqual({ text: "Target reached", over: false });
    expect(exertionStatus({ soFar: 7.1, target })).toEqual({ text: "Over target", over: true });
  });
  it("says nothing without a target", () => {
    expect(exertionStatus({ soFar: 4, target: null })).toEqual({ text: null, over: false });
  });
});
