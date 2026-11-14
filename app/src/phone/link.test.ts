// The API keys come across even when the row sync stops partway, and a failure is shown, not lost.
import { beforeEach, describe, expect, it, vi } from "vitest";

let syncReplies: (() => unknown)[] = [];
let keys: () => Promise<number> = async () => 1;
const calls: string[] = [];
vi.mock("./plugin", () => ({
  phoneStatus: async () => ({ paired: { computer: "Mac", deviceId: "d", lastSentAt: null } }),
  send: async (kind: string) => {
    calls.push(kind);
    const next = syncReplies.shift();
    if (!next) throw new Error("no reply");
    return next();
  },
}));
vi.mock("./keys", () => ({ syncKeys: () => keys() }));
vi.mock("~/platform/native", () => ({
  invoke: async (cmd: string) => (cmd === "sync_outgoing" ? { cursor: null, changes: [], upto: 0, more: false } : 5),
}));
vi.mock("~/settings/shared-prefs", () => ({ applySharedPrefs: async () => {} }));
vi.mock("~/shims/next-cache", () => ({ revalidatePath: () => {} }));
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.stubGlobal("CustomEvent", class {
  constructor(public type: string, public init?: unknown) {}
});

import { onLinkState, syncWithComputer, type LinkState } from "./link";

let last: LinkState;
onLinkState((s) => (last = s));

beforeEach(() => {
  calls.length = 0;
  keys = async () => 1;
});

describe("syncWithComputer", () => {
  it("still syncs keys when a later round of rows fails", async () => {
    const more = () => ({ cursor: null, changes: [], more: true, applied: 0, rejected: [] });
    syncReplies = [more, () => { throw new Error("row failed"); }];
    let synced = false;
    keys = async () => ((synced = true), 1);
    await syncWithComputer();
    expect(synced).toBe(true);
    expect(last.error).toBe("row failed");
    expect(last.keysError).toBeNull();
  });

  it("says why the keys didn't come across", async () => {
    syncReplies = [() => ({ cursor: null, changes: [], more: false, applied: 0, rejected: [] })];
    keys = async () => {
      throw new Error("The keychain on the computer is locked");
    };
    await syncWithComputer();
    expect(last.error).toBeNull();
    expect(last.keysError).toBe("The keychain on the computer is locked");
  });

  it("doesn't try keys when the computer never answered", async () => {
    syncReplies = [];
    let tried = false;
    keys = async () => ((tried = true), 0);
    await syncWithComputer();
    expect(tried).toBe(false);
    expect(last.running).toBe(false);
  });
});
