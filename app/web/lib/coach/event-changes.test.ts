import { describe, expect, it } from "vitest";
import { buildPlan, type Goal } from "../engine/plan";
import { addDays } from "../engine/pmc";
import { runTool, type CoachData } from "./tools";
import { resolveChange } from "./changes";
import { data, state, today } from "./fixture";

const race: Goal = { id: "cx", name: "State Champs", date: addDays(today, 7), priority: "A", kind: "cyclocross" };

function withGoals(goals: Goal[], extra: Partial<typeof state> = {}): CoachData {
  const plan = buildPlan({ today, goals, availability: state.athlete.availability, fitness: state.fitness, fatigue: state.fatigue, levels: state.levels });
  return { ...data, state: { ...state, goals, plan, basePlan: plan, ...extra } };
}

describe("event proposals", () => {
  it("moves an event and lists the days the plan rebuilds", () => {
    const d = withGoals([race]);
    const r = runTool(d, "propose_event", { action: "edit", event_id: "cx", date: addDays(today, 2), reason: "It's sooner" });
    expect(r.content).not.toMatch(/^Error/);
    const p = r.proposal!;
    expect(p.change).toMatchObject({ kind: "event", action: "edit", id: "cx" });
    expect(p.summary).toMatch(/State Champs: .+ → /);
    const days = p.preview!.days!;
    expect(days.find((x) => x.date === addDays(today, 2))).toMatchObject({ event: true });
    expect(days.some((x) => x.date === race.date && x.before.startsWith("State Champs"))).toBe(true);
    expect(p.preview!.stats![0].label).toBe("Race-day form");
  });

  it("adds an event with its details", () => {
    const r = runTool(withGoals([]), "propose_event", { action: "add", name: "Cross Rev", date: addDays(today, 10), priority: "B", kind: "cyclocross", reason: "For fun" });
    expect(r.proposal!.summary).toMatch(/^Add Cross Rev: /);
    expect(r.proposal!.preview!.fields![0]).toEqual({ label: "Priority", value: "B, short taper" });
    expect(r.proposal!.preview!.days!.some((x) => x.event)).toBe(true);
  });

  it("shows only what an edit changes", () => {
    const r = runTool(withGoals([race]), "propose_event", { action: "edit", event_id: "cx", priority: "B", start_time: "10:45", reason: "x" });
    expect(r.proposal!.summary).toBe("Change State Champs");
    expect(r.proposal!.preview!.fields).toEqual([
      { label: "Priority", value: "A → B" },
      { label: "Start", value: "10:45" },
    ]);
  });

  it("refuses bad or empty changes with reasons the coach can act on", () => {
    const d = withGoals([race]);
    expect(runTool(d, "propose_event", { action: "edit", event_id: "nope", date: today, reason: "x" }).content).toMatch(/get_events/);
    expect(runTool(d, "propose_event", { action: "edit", event_id: "cx", date: addDays(today, -1), reason: "x" }).content).toMatch(/past/);
    expect(runTool(d, "propose_event", { action: "edit", event_id: "cx", reason: "x" }).content).toMatch(/already/);
    expect(runTool(d, "propose_event", { action: "add", name: "X", date: addDays(today, 3), priority: "A", reason: "x" }).content).toMatch(/kind/);
  });

  it("won't remove an event a plan peaks for", () => {
    const plan = { id: "p", name: "Build to State Champs", start: today, end: race.date, goal: "event" as const, goalId: "cx", target: null };
    const d = withGoals([race], { plans: [plan], activePlan: plan });
    expect(runTool(d, "propose_event", { action: "remove", event_id: "cx", reason: "x" }).content).toMatch(/end that plan first/);
    expect(runTool(withGoals([race]), "propose_event", { action: "remove", event_id: "cx", reason: "x" }).proposal!.summary).toMatch(/^Remove State Champs/);
  });

  it("resets the coach's changes in the new run-in", () => {
    const d = withGoals([race], { changedDays: [addDays(today, 1), addDays(today, 20)] });
    const effect = resolveChange(d.state, { kind: "event", action: "edit", id: "cx", event: { date: addDays(today, 3) } });
    expect(effect).toMatchObject({ kind: "event", reset: [addDays(today, 1)], from: race.date });
  });
});

describe("plan proposals", () => {
  it("starts a plan for an event, with its weeks", () => {
    const far = { ...race, date: addDays(today, 35) };
    const r = runTool(withGoals([far]), "propose_plan", { action: "add", goal: "event", event_id: "cx", reason: "Peak for it" });
    expect(r.content).not.toMatch(/^Error/);
    expect(r.proposal!.summary).toMatch(/^New plan: Build to State Champs, /);
    expect(r.proposal!.preview!.weeks!.length).toBeGreaterThan(3);
    expect(r.proposal!.preview!.stats!.map((s) => s.label)).toEqual(["Fitness on race day", "Form"]);
  });

  it("checks plan dates", () => {
    expect(runTool(withGoals([]), "propose_plan", { action: "add", goal: "ftp", end: addDays(today, 5), reason: "x" }).content).toMatch(/two weeks/);
    expect(runTool(withGoals([]), "propose_plan", { action: "add", goal: "event", reason: "x" }).content).toMatch(/propose_event/);
  });

  it("ends a running plan", () => {
    const plan = { id: "p", name: "FTP block", start: addDays(today, -10), end: addDays(today, 30), goal: "ftp" as const, goalId: null, target: null };
    const r = runTool(withGoals([], { plans: [plan], activePlan: plan }), "propose_plan", { action: "end", plan_id: "p", reason: "x" });
    expect(r.proposal!.summary).toBe("End FTP block today");
  });
});
