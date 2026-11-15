import { describe, expect, it } from "vitest";
import { completeWithRetry, retryable } from "./chat";
import type { ChatMessage, Complete } from "./openrouter";
import { briefError } from "../../app/coach/events";

const say = (content: string): ChatMessage => ({ role: "assistant", content });
const noWait = async () => {};

describe("model calls that fail partway", () => {
  it("tries a dropped connection again and drops what the failed try streamed", async () => {
    let calls = 0;
    const events: string[] = [];
    const complete: Complete = async (_m, _t, onText) => {
      calls++;
      onText?.(`try ${calls} `);
      if (calls === 1) throw new TypeError("The connection dropped partway through the reply (connection reset by peer)");
      return say("Ride as planned.");
    };
    const reply = await completeWithRetry(complete, [], [], { onTurn: () => events.push("reset"), onText: (d) => events.push(d) }, noWait);
    expect(reply.content).toBe("Ride as planned.");
    expect(events).toEqual(["reset", "try 1 ", "reset", "try 2 "]);
  });

  it("gives up after three tries", async () => {
    let calls = 0;
    const complete: Complete = async () => {
      calls++;
      throw new TypeError("error decoding response body");
    };
    await expect(completeWithRetry(complete, [], [], {}, noWait)).rejects.toThrow("decoding");
    expect(calls).toBe(3);
  });

  it("doesn't retry what another try can't fix", async () => {
    let calls = 0;
    const complete: Complete = async () => {
      calls++;
      throw new Error("The AI provider turned the key down. Check it in Settings → Coach.");
    };
    await expect(completeWithRetry(complete, [], [], {}, noWait)).rejects.toThrow("key down");
    expect(calls).toBe(1);
  });

  it("knows which errors might pass", () => {
    expect(retryable(new TypeError("Load failed"))).toBe(true);
    expect(retryable(new Error("The AI provider answered 502: Bad gateway"))).toBe(true);
    expect(retryable(new Error("The AI provider is rate limiting. Try again in a minute."))).toBe(false);
    expect(retryable(new Error("This month's AI budget ($5.00) is used up"))).toBe(false);
  });
});

describe("the brief's error line", () => {
  it("says a dropped connection in plain words", () => {
    expect(briefError("error decoding response body")).toBe("The coach couldn't write today's brief: the connection dropped.");
  });
  it("keeps other reasons", () => {
    expect(briefError("The model wasn't found (x). Pick another in Settings → Coach.")).toBe("The coach couldn't write today's brief. The model wasn't found (x). Pick another in Settings → Coach.");
    expect(briefError("No model chosen")).toBe("The coach couldn't write today's brief. No model chosen.");
  });
});
