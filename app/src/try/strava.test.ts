import { describe, expect, it } from "vitest";
import { authorizeUrl, readReturn, stravaText, toBase64 } from "./strava";
import { steady } from "@shared/engine/workout";

const workout = {
  name: "Sweet spot 2 × 8",
  segments: [steady(600, 0.6), steady(480, 0.9)],
};

describe("try-a-ride Strava", () => {
  it("asks only to upload, and comes back to lactic.fit", () => {
    const url = new URL(authorizeUrl("138921", "https://lactic.fit", "abc"));
    expect(url.searchParams.get("scope")).toBe("activity:write");
    expect(url.searchParams.get("redirect_uri")).toBe("https://lactic.fit/strava/back.html");
    expect(url.searchParams.get("state")).toBe("abc");
  });

  it("reads the sign-in's answer", () => {
    expect(readReturn("?state=abc&code=xyz&scope=read,activity:write", "abc")).toEqual({ code: "xyz" });
    expect(readReturn("?state=old&code=xyz&scope=activity:write", "abc")).toBeNull();
    expect(readReturn("?state=abc&error=access_denied", "abc")).toHaveProperty("error");
    expect(readReturn("?state=abc&code=xyz&scope=read", "abc")).toHaveProperty("error");
  });

  it("posts the same words as the app, signed by Lactic", () => {
    const text = stravaText({ name: "Sweet spot 2 × 8", workout });
    expect(text.name).toBe("Sweet spot 2 × 8");
    expect(text.description).toMatch(/Trained with Lactic · lactic\.fit$/);
  });

  it("encodes the .fit file", () => {
    expect(toBase64(new Uint8Array([0, 1, 2, 250]))).toBe(Buffer.from([0, 1, 2, 250]).toString("base64"));
  });
});
