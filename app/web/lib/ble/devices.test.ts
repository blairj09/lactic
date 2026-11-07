import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectGatt, findRemembered, forgetDevice, rememberDevice, remembered, renameDevice } from "./devices";

const device = (id: string, name: string) => ({ id, name, gatt: { connect: async () => ({}), disconnect: vi.fn() } }) as unknown as BluetoothDevice;

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => items.set(k, v) });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("remembered devices", () => {
  it("shows the user's name for a device and falls back to the advertised one", () => {
    rememberDevice("trainer", device("k1", "KICKR 1234"));
    renameDevice("trainer", "Garage KICKR");
    expect(remembered("trainer")).toMatchObject({ name: "Garage KICKR", deviceName: "KICKR 1234" });
    renameDevice("trainer", "  ");
    expect(remembered("trainer")?.name).toBe("KICKR 1234");
  });

  it("records when a remembered device last connected", async () => {
    const kickr = device("k1", "KICKR 1234");
    rememberDevice("trainer", kickr);
    expect(remembered("trainer")?.lastSeen).toBeUndefined();
    await connectGatt(kickr);
    expect(remembered("trainer")?.lastSeen).toBeDefined();
  });

  it("forgets one device and keeps the rest", async () => {
    rememberDevice("trainer", device("k1", "KICKR"));
    rememberDevice("scale", device("s1", "Body Pod"));
    await forgetDevice("trainer");
    expect(remembered("trainer")).toBeUndefined();
    expect(remembered("scale")?.name).toBe("Body Pod");
  });

  it("keeps the nickname when the same device is picked again", () => {
    rememberDevice("heartRate", device("w1", "JAMES HRM"));
    renameDevice("heartRate", "Strap");
    rememberDevice("heartRate", device("w2", "JAMES HRM"));
    expect(remembered("heartRate")).toMatchObject({ id: "w2", name: "Strap" });
    rememberDevice("heartRate", device("w3", "OTHER HRM"));
    expect(remembered("heartRate")).toMatchObject({ id: "w3", name: "OTHER HRM" });
  });

  it("finds a remembered device by name when Chrome has given it a new id", async () => {
    rememberDevice("heartRate", device("old", "JAMES HRM"));
    const strap = device("new", "JAMES HRM");
    vi.stubGlobal("navigator", { bluetooth: { getDevices: async () => [device("k1", "KICKR"), strap] } });
    expect(await findRemembered("heartRate")).toBe(strap);
    expect(remembered("heartRate")?.id).toBe("new");
  });
});
