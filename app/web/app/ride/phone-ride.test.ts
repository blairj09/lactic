import { describe, expect, it } from "vitest";
import { DEFAULT_RIDE_PAGE, type RidePage } from "@/lib/sdk/layout";
import { phonePages } from "./phone-ride";
import type { PlayerData } from "./player";

const mine: RidePage = { name: "Climb", template: "four", fields: [{ metric: "power" }] };
const ride = (over: Partial<PlayerData>) =>
  ({ erg: null, headUnit: false, fields: { pages: [DEFAULT_RIDE_PAGE, mine], overlay: [], page: 0, values: {} }, ...over }) as PlayerData;

describe("phonePages", () => {
  it("puts Ride first, the rider's pages next (not the standard one again) and Up next last", () => {
    expect(phonePages(ride({})).map((p) => p.name)).toEqual(["Ride", "Climb", "Up next"]);
  });

  it("has no Up next without a workout", () => {
    expect(phonePages(ride({ headUnit: true })).map((p) => p.name)).toEqual(["Ride", "Climb"]);
    expect(phonePages(ride({ erg: { watts: 200 } })).map((p) => p.name)).toEqual(["Ride", "Climb"]);
  });
});
