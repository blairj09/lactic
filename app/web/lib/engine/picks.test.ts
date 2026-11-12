import { describe, expect, it } from "vitest";
import { STARTING_LEVELS } from "./library";
import { applyPicks, holdsFavorite, pickFits, unpickedKeyDays } from "./picks";
import { libraryFits, librarySession, WORKOUT_LIBRARY } from "./workout-library";
import type { Plan } from "./plan";
import { buildPlan, DEFAULT_RAMP_RATE, type Availability } from "./plan";

const today = "2026-11-02";
const availability: Availability = [0, 60, 90, 60, 0, 180, 120];
const plan = buildPlan({ today, goals: [], availability, fitness: 50, fatigue: 50, levels: STARTING_LEVELS, rampRate: DEFAULT_RAMP_RATE });
const keys = plan.weeks.flatMap((w) => w.days).filter((d) => d.role === "key");

describe("coach picks over the plan", () => {
  it("rebuilds a key day in the picked structure at the engine's level and length, with the reason", () => {
    const day = keys[0];
    const template = `${day.session!.zone}-intervals` === day.session!.template ? other(day.session!.zone) : `${day.session!.zone}-intervals`;
    const out = applyPicks(plan, [{ date: day.date, template, reason: "Because." }], today, { fitness: 50, fatigue: 50 });
    const picked = out.weeks.flatMap((w) => w.days).find((d) => d.date === day.date)!;
    expect(picked.session!.template).toBe(template);
    expect(picked.session!.level).toBe(day.session!.level);
    expect(picked.session!.duration).toBe(day.session!.duration);
    expect(picked.why).toBe("Because.");
    expect(picked.stress).toBe(picked.session!.stress);
  });

  it("ignores picks that no longer fit the day", () => {
    const day = keys[0];
    const wrongZone = day.session!.zone === "vo2max" ? "threshold-overunder" : "vo2max-3030";
    const rest = plan.weeks.flatMap((w) => w.days).find((d) => d.role === "rest")!;
    expect(applyPicks(plan, [{ date: day.date, template: wrongZone, reason: "x" }, { date: rest.date, template: "vo2max-3030", reason: "x" }], today, { fitness: 50, fatigue: 50 })).toBe(plan);
  });

  it("lists key days still waiting for a pick", () => {
    const through = keys[keys.length - 1].date;
    expect(unpickedKeyDays(plan, [], today, through)).toHaveLength(keys.length);
    const pick = { date: keys[0].date, template: `${keys[0].session!.zone}-intervals`, reason: "x" };
    expect(unpickedKeyDays(plan, [pick], today, through)).toHaveLength(keys.length - 1);
  });
});

describe("coach picks and favorites", () => {
  const start = { fitness: 50, fatigue: 50 };
  // The first key day some starter workout fits.
  const day = keys.find((d) => libraryFits(d.session!.zone, d.session!.level, d.session!.duration).length)!;
  const fit = libraryFits(day.session!.zone, day.session!.level, day.session!.duration)[0];
  const withFavorite = (p: Plan): Plan => ({
    ...p,
    weeks: p.weeks.map((w) => ({ ...w, days: w.days.map((d) => (d.date === day.date ? { ...d, session: { ...librarySession(fit), favorite: true } } : d)) })),
  });

  it("picks a fixed workout that fits the day, and refuses one that doesn't", () => {
    expect(pickFits(day, `library:${fit.id}`)).toBe(true);
    const wrong = WORKOUT_LIBRARY.find((w) => w.zone !== day.session!.zone && w.category !== "tests")!;
    expect(pickFits(day, `library:${wrong.id}`)).toBe(false);
    const out = applyPicks(plan, [{ date: day.date, template: `library:${fit.id}`, reason: "A favorite." }], today, start);
    const picked = out.weeks.flatMap((w) => w.days).find((d) => d.date === day.date)!;
    expect(picked.session!.library).toBe(fit.id);
    expect(picked.why).toBe("A favorite.");
  });

  it("may pick over a library workout the plan chose that isn't a favorite", () => {
    const lib = plan.weeks.flatMap((w) => w.days).find((d) => d.role === "key" && d.session?.library);
    if (lib) expect(holdsFavorite(lib)).toBe(false);
    expect(holdsFavorite({ ...day, session: librarySession(fit) })).toBe(false);
  });

  it("never picks over a favorite the plan chose, nor asks the coach to", () => {
    const fav = withFavorite(plan);
    const favDay = fav.weeks.flatMap((w) => w.days).find((d) => d.date === day.date)!;
    expect(holdsFavorite(favDay)).toBe(true);
    expect(applyPicks(fav, [{ date: day.date, template: `${day.session!.zone}-intervals`, reason: "x" }], today, start)).toBe(fav);
    const through = keys[keys.length - 1].date;
    expect(unpickedKeyDays(fav, [], today, through).map((d) => d.date)).not.toContain(day.date);
    expect(unpickedKeyDays(fav, [], today, through)).toHaveLength(keys.length - 1);
  });
});

function other(zone: string) {
  return { tempo: "tempo-bursts", sweetSpot: "sweetSpot-surges", threshold: "threshold-overunder", vo2max: "vo2max-3030", anaerobic: "anaerobic-attacks" }[zone]!;
}
