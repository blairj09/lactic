import { describe, expect, it } from "vitest";
import { passkeysWorkOn } from "./config";

describe("passkeysWorkOn", () => {
  it("allows the relying party and its subdomains", () => {
    expect(passkeysWorkOn("coach.jamesblair.me")).toBe(true);
    expect(passkeysWorkOn("Coach.JamesBlair.me:443")).toBe(true);
    expect(passkeysWorkOn("x.coach.jamesblair.me")).toBe(true);
  });

  it("refuses previews, localhost and look-alikes", () => {
    expect(passkeysWorkOn("mycoach-git-main-james-blairs-projects.vercel.app")).toBe(false);
    expect(passkeysWorkOn("localhost:3000")).toBe(false);
    expect(passkeysWorkOn("evilcoach.jamesblair.me")).toBe(false);
    expect(passkeysWorkOn(null)).toBe(false);
  });
});
