import { describe, expect, it } from "vitest";
import { recoverySourceInfo } from "./recovery-source";

describe("recoverySourceInfo", () => {
  it("is unknown until a source is picked or Apple Health sends", () => {
    expect(recoverySourceInfo({ picked: null, appleReceiving: false }, true)).toBeNull();
  });
  it("names Apple Health once its files arrive, even without a pick", () => {
    expect(recoverySourceInfo({ picked: null, appleReceiving: true }, false)).toEqual({ name: "Apple Health", connected: true });
  });
  it("names the picked source and whether it's connected", () => {
    expect(recoverySourceInfo({ picked: "apple", appleReceiving: false }, true)).toEqual({ name: "Apple Health", connected: false });
    expect(recoverySourceInfo({ picked: "intervals", appleReceiving: false }, true)).toEqual({ name: "intervals.icu", connected: true });
    expect(recoverySourceInfo({ picked: "intervals", appleReceiving: false }, false)).toEqual({ name: "intervals.icu", connected: false });
  });
});
