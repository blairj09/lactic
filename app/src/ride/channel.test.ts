import { describe, expect, it } from "vitest";
import { sendableArgs } from "./channel";

describe("sendableArgs", () => {
  it("keeps plain values and drops a click event", () => {
    const event = { nativeEvent: {} as Record<string, unknown> };
    event.nativeEvent.self = event;
    expect(sendableArgs([event])).toEqual([]);
    expect(() => JSON.stringify(sendableArgs([event]))).not.toThrow();
    expect(sendableArgs([5, "erg", true, null, undefined, {}])).toEqual([5, "erg", true, null]);
  });
});
