import { describe, expect, it } from "vitest";
import { identifyScale } from "./models";

describe("identifyScale", () => {
  it("knows scales by name", () => {
    expect(identifyScale({ name: "Body Pod 2" })).toBe("bodyPod");
    expect(identifyScale({ name: "MIBCS" })).toBe("xiaomi");
    expect(identifyScale({ name: "MI SCALE2" })).toBe("xiaomi");
    expect(identifyScale({ name: "QN-Scale1" })).toBe("qn");
    expect(identifyScale({ name: "Etekcity Fitness Scale" })).toBe("etekcity");
  });

  it("knows unnamed Xiaomi scales by their broadcast and Etekcity by company id", () => {
    expect(identifyScale({ serviceData: { "0000181b-0000-1000-8000-00805f9b34fb": new Array(13).fill(0) } })).toBe("xiaomi");
    expect(identifyScale({ serviceData: { "181d": new Array(10).fill(0) } })).toBe("xiaomi");
    expect(identifyScale({ manufacturerData: { "1744": [1, 2, 3] } })).toBe("etekcity");
  });

  it("knows standard scales by service, and ignores everything else", () => {
    expect(identifyScale({ name: "BF600", services: ["0000181d-0000-1000-8000-00805f9b34fb"] })).toBe("standard");
    expect(identifyScale({ name: "KICKR CORE", services: ["00001826-0000-1000-8000-00805f9b34fb"] })).toBeNull();
    expect(identifyScale({ name: "HMSoft", services: ["ffe0"] })).toBeNull();
  });
});
