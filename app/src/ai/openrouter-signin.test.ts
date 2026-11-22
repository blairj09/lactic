// Sign in with OpenRouter: the computer leaves it all to the Rust core; the iPhone shows the page in
// a sign-in sheet and hands back the code and state it came back with.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: [string, unknown][] = [];
let phone = false;
vi.mock("~/platform/native", () => ({
  isDesktop: true,
  isPhone: () => phone,
  invoke: async (command: string, args?: unknown) => {
    calls.push([command, args]);
    if (command === "openrouter_begin") return { url: "https://openrouter.ai/auth?code_challenge=c&state=app-ab" };
  },
}));
vi.mock("~/phone/plugin", () => ({
  webAuth: async (url: string, scheme: string) => ({ url: `${scheme}://lactic.fit/openrouter?code=k1&state=${new URL(url).searchParams.get("state")}` }),
}));

import { readReturn, signInWithOpenRouter } from "./openrouter-signin";

describe("Sign in with OpenRouter", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("on a computer, the Rust core does the whole sign-in", async () => {
    phone = false;
    await signInWithOpenRouter();
    expect(calls).toEqual([["openrouter_connect", undefined]]);
  });

  it("on the iPhone, passes the code and state from the sign-in sheet on", async () => {
    phone = true;
    await signInWithOpenRouter();
    expect(calls.map((c) => c[0])).toEqual(["openrouter_begin", "openrouter_finish"]);
    expect(calls[1][1]).toEqual({ code: "k1", state: "app-ab" });
  });

  it("reads the address the sheet came back to", () => {
    expect(readReturn("lactic://lactic.fit/openrouter?code=abc&state=app-1")).toEqual({ code: "abc", state: "app-1" });
    expect(() => readReturn("lactic://lactic.fit/openrouter?state=app-1")).toThrow(/didn't finish/);
    expect(() => readReturn("not a url")).toThrow(/unexpected/);
  });
});
