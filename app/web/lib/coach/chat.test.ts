import { describe, expect, it } from "vitest";
import { resolveChange } from "./changes";
import { coachChat, morningBrief, planWeek, summarize } from "./chat";
import type { ChatMessage } from "./openrouter";
import { data, plan, state } from "./fixture";
import { runTool } from "./tools";

const call = (name: string, args: unknown, id = name): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const say = (content: string): ChatMessage => ({ role: "assistant", content });

describe("coach tools", () => {
  it("reads rides in the athlete's time zone", () => {
    const rides = JSON.parse(runTool(data, "get_rides", {}).content);
    expect(rides.rides[0]).toMatchObject({ id: "r1", date: "2026-10-27", stress: 74, normalizedWatts: 215 });
    expect(JSON.parse(runTool(data, "get_rides", { from: "2026-10-28" }).content).count).toBe(0);
  });

  it("reports power per kg from the engine's curve", () => {
    const power = JSON.parse(runTool(data, "get_power", {}).content);
    expect(power.bestPower.find((p: { duration: string }) => p.duration === "20min")).toMatchObject({ watts: 240, wattsPerKg: 3.2 });
  });

  it("gives imperial riders lb and miles to quote, so it never converts", () => {
    const metric = JSON.parse(runTool(data, "get_athlete", {}).content);
    expect(metric.weightLb).toBeUndefined();
    const imperial = { ...data, units: "imperial" as const };
    expect(JSON.parse(runTool(imperial, "get_athlete", {}).content).weightLb).toBe(Math.round(metric.weightKg * 2.20462 * 10) / 10);
    const ride = JSON.parse(runTool(imperial, "get_rides", {}).content).rides[0];
    if (ride.km !== null) expect(ride.miles).toBeCloseTo(ride.km / 1.609344, 0);
  });

  it("returns errors as text the coach can act on", () => {
    expect(runTool(data, "get_ride", { id: "nope" }).content).toMatch(/^Error: No ride/);
    expect(runTool(data, "get_rides", { from: "last week" }).content).toMatch(/^Error: Dates/);
  });

  it("only proposes options the engine offers", () => {
    expect(runTool(data, "propose_day_change", { date: "2026-10-31", option_id: "doubleDay", reason: "x" }).content).toMatch(/^Error/);
    const ok = runTool(data, "propose_day_change", { date: "2026-10-31", option_id: "rest", reason: "Travelling" });
    expect(ok.proposal).toMatchObject({ change: { kind: "day", date: "2026-10-31", option: "rest" }, reason: "Travelling", status: "pending" });
    expect(ok.proposal!.summary).toMatch(/Sat, Oct 31: .* → Rest/);
  });

  it("won't change past days or days too far ahead", () => {
    expect(() => resolveChange(state, { kind: "reset", date: "2026-10-28" })).toThrow(/Past/);
    expect(() => resolveChange(state, { kind: "reset", date: "2026-12-30" })).toThrow(/next/);
  });

  it("swaps two days", () => {
    const effect = resolveChange(state, { kind: "swap", date: "2026-10-30", otherDate: "2026-10-31" });
    const sat = plan.weeks[0].days[5].session;
    expect(effect).toMatchObject({ kind: "days", days: [{ date: "2026-10-30", session: sat }, { date: "2026-10-31", session: null }] });
  });

  it("previews new hours with the engine", () => {
    const effect = resolveChange(state, { kind: "availability", availability: [0, 90, 90, 90, 0, 240, 180] });
    expect(effect.kind).toBe("settings");
    expect(effect.summary).toMatch(/Hours available 8\.5 → 11\.5 a week/);
  });
});

describe("coach chat", () => {
  it("answers after reading data, passing status and history", async () => {
    const seen: ChatMessage[][] = [];
    const replies = [call("get_rides", { limit: 1 }), say("Solid sweet spot yesterday: 74 TSS.")];
    const statuses: string[] = [];
    const reply = await coachChat(async (m) => (seen.push([...m]), replies.shift()!), data, [{ role: "user", content: "How did my last ride go?" }], "", {
      onStatus: (s) => statuses.push(s),
    });
    expect(reply).toEqual({ message: "Solid sweet spot yesterday: 74 TSS.", proposals: [], memory: [], picks: [] });
    expect(seen[0][0].content).toContain('"ftp":250');
    expect(seen[0].at(-1)).toEqual({ role: "user", content: "How did my last ride go?" });
    expect(seen[1].at(-1)!.content).toContain("Sweet spot 3 x 12");
    expect(statuses).toEqual(["Looking at your rides"]);
  });

  it("collects proposals once each", async () => {
    const replies = [
      call("propose_swap", { date: "2026-10-30", other_date: "2026-10-31", reason: "Busy Saturday" }),
      call("propose_swap", { date: "2026-10-30", other_date: "2026-10-31", reason: "Busy Saturday" }, "again"),
      say("I've proposed swapping Friday and Saturday."),
    ];
    const reply = await coachChat(async () => replies.shift()!, data, [{ role: "user", content: "Busy Saturday" }]);
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0].change).toEqual({ kind: "swap", date: "2026-10-30", otherDate: "2026-10-31" });
  });

  it("asks for an answer after an empty reply, and gives up eventually", async () => {
    const replies = [say(""), say("Here you go.")];
    expect((await coachChat(async () => replies.shift()!, data, [{ role: "user", content: "hi" }])).message).toBe("Here you go.");
    await expect(coachChat(async () => say(""), data, [{ role: "user", content: "hi" }])).rejects.toThrow();
  });
});

describe("coach memory and summary", () => {
  it("saves and forgets facts after checking them", async () => {
    const withMemory = { ...data, memory: [{ id: "m1", fact: "Left knee sore on long rides", source: "coach" as const }] };
    const seen: ChatMessage[][] = [];
    const replies = [
      { role: "assistant" as const, content: null, tool_calls: [
        { id: "a", type: "function" as const, function: { name: "remember", arguments: JSON.stringify({ fact: "Prefers rides before 7am" }) } },
        { id: "b", type: "function" as const, function: { name: "remember", arguments: JSON.stringify({ fact: "left knee sore on long rides" }) } },
        { id: "c", type: "function" as const, function: { name: "forget", arguments: JSON.stringify({ id: "m1" }) } },
        { id: "d", type: "function" as const, function: { name: "forget", arguments: JSON.stringify({ id: "nope" }) } },
      ] },
      say("Noted."),
    ];
    const reply = await coachChat(async (m) => (seen.push([...m]), replies.shift()!), withMemory, [{ role: "user", content: "Knee's fine now. I ride early." }], "They asked about base training.");
    expect(reply.memory).toEqual([{ op: "add", fact: "Prefers rides before 7am" }, { op: "remove", id: "m1" }]);
    expect(seen[0][0].content).toContain("m1: Left knee sore on long rides");
    expect(seen[0][0].content).toContain("Summary of your earlier conversation:\nThey asked about base training.");
    expect(seen[1].slice(-4).map((m) => m.content)).toEqual([expect.stringContaining("saved"), "Already saved.", expect.stringContaining("forgotten"), expect.stringMatching(/^Error: No saved fact/)]);
  });

  it("folds messages into the summary", async () => {
    let prompt = "";
    const summary = await summarize(async (m) => ((prompt = m[1].content!), say("They want to peak in March.")), "Old summary.", [
      { role: "user", content: "When should I peak?", createdAt: "2026-10-01T10:00:00Z" },
      { role: "assistant", content: "March.", kind: "brief" },
    ]);
    expect(summary).toBe("They want to peak in March.");
    expect(prompt).toContain("Current summary:\nOld summary.");
    expect(prompt).toContain("[2026-10-01] Athlete: When should I peak?");
    expect(prompt).toContain("(brief) Coach: March.");
  });

  it("streams text and drops thinking aloud before tool calls", async () => {
    const events: string[] = [];
    const replies = [
      { role: "assistant" as const, content: "Let me look.", tool_calls: [{ id: "x", type: "function" as const, function: { name: "get_rides", arguments: "{}" } }] },
      say("All good."),
    ];
    await coachChat(
      async (_m, _t, onText) => {
        const r = replies.shift()!;
        if (r.content) onText?.(r.content);
        return r;
      },
      data,
      [{ role: "user", content: "hi" }],
      "",
      { onTurn: () => events.push("reset"), onText: (d) => events.push(d) },
    );
    expect(events).toEqual(["reset", "Let me look.", "reset", "All good."]);
  });
});

describe("morning brief", () => {
  it("reads data and can propose changes, but can't save memory", async () => {
    let tools: unknown[] = [];
    const replies = [
      call("get_day_options", { date: "2026-10-29" }),
      call("propose_day_change", { date: "2026-10-29", option_id: "recovery", reason: "Poor sleep" }),
      say("Recovery is low, so I've suggested a recovery spin today."),
    ];
    const reply = await morningBrief(async (_m, t) => ((tools = t), replies.shift()!), data, []);
    expect(reply.message).toMatch(/recovery spin/);
    expect(reply.proposals).toHaveLength(1);
    expect(reply.proposals[0].change).toMatchObject({ kind: "day", date: "2026-10-29", option: "recovery" });
    const names = (tools as { function: { name: string } }[]).map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(["get_rides", "get_plan", "propose_day_change", "propose_availability"]));
    expect(names.some((n) => n === "remember" || n === "forget")).toBe(false);
  });

  it("sees today's weigh-in in the status", async () => {
    let system = "";
    const weighed = { ...data, body: [{ id: "b", measuredAt: new Date("2026-10-29T15:00:00Z"), weightKg: 74.62, bodyFatPercent: 14.04, bmi: 23, fatFreeMassKg: 64 }] };
    await morningBrief(async (m) => ((system = m[0].content!), say("Weighed in at 74.6 kg.")), weighed, []);
    expect(system).toContain('"weighInToday":{"weightKg":74.6,"bodyFatPercent":14}');
  });
  it("reads how the athlete feels and suggests one of today's options", async () => {
    const felt = {
      ...data,
      state: {
        ...state,
        todayStored: {
          day: "2026-10-29",
          planned: null,
          chosen: null,
          checkin: { feel: 2, sick: false, minutes: 40, notes: "Legs heavy", recovery: null, form: -5, recommended: "rest" as const, reasons: [], coach: null, at: "2026-10-29T14:00:00Z" },
          activityId: null,
          feelAfter: null,
        },
      },
    };
    let system = "";
    const replies = [call("suggest_today", { option_id: "harder" }), call("suggest_today", { option_id: "recovery" }, "again"), say("Heavy legs: spin easy for 40 minutes.")];
    const reply = await morningBrief(async (m) => ((system = m[0].content!), replies.shift()!), felt, []);
    expect(system).toContain('"checkin":{"felt":"Tired","minutesAvailable":40,"note":"Legs heavy"}');
    expect(reply.today).toBe("recovery");
    expect(runTool(felt, "suggest_today", { option_id: "harder" }).content).toMatch(/^Error: option_id must be one of recovery, rest/);
  });

  it("has nothing to suggest once today is settled", () => {
    const chosen = { ...data, state: { ...state, todayStored: { day: "2026-10-29", planned: null, chosen: { option: "rest" as const, session: null }, checkin: null, activityId: null, feelAfter: null } } };
    expect(runTool(chosen, "suggest_today", { option_id: "rest" }).content).toMatch(/settled/);
  });
});

describe("break proposals", () => {
  it("works out a break and its effect, and refuses bad ones", () => {
    const effect = resolveChange(state, { kind: "break", break: { start: "2026-11-09", end: "2026-11-13", kind: "travel", riding: "off", note: "Work trip" } });
    expect(effect.kind).toBe("break");
    expect(effect.summary).toMatch(/Travel break Mon, Nov 9 to Fri, Nov 13, off the bike/);
    expect(() => resolveChange(state, { kind: "break", break: { start: "2026-10-01", end: "2026-10-05", kind: "travel", riding: "off" } })).toThrow(/over/);
    expect(() => resolveChange(state, { kind: "break", break: { start: "2026-11-09", end: "2026-11-13", kind: "travel", riding: "limited" } })).toThrow(/minutes/);
  });

  it("gets the engine's race-day plan in the status on an event day", async () => {
    const goal = { id: "g", name: "UTCX Art Dye", date: "2026-10-29", priority: "B" as const, kind: "cyclocross" as const };
    const days = plan.weeks.map((w) => ({ ...w, days: w.days.map((d) => (d.date === "2026-10-29" ? { ...d, role: "event" as const, goal, session: null } : d)) }));
    const race = { ...data, state: { ...state, plan: { ...plan, weeks: days } } };
    let system = "";
    await morningBrief(async (m) => ((system = m[0].content!), say("Go hard off the line.")), race, []);
    expect(system).toContain('"raceToday":{"name":"UTCX Art Dye","kind":"Cyclocross","priority":"B","minutes":50');
    expect(system).toContain('"watts":"245-265"');
  });
});

describe("workout structures in the chat", () => {
  it("lists structures with targets and proposes one with targets set", () => {
    const list = JSON.parse(runTool(data, "get_workouts", { zone: "threshold" }).content);
    expect(list.workouts.map((w: { id: string }) => w.id)).toContain("threshold-overunder");
    const day = data.state.plan.weeks.flatMap((w) => w.days).find((d) => d.date > data.state.today && d.role === "key")!;
    const result = runTool(data, "propose_workout", { date: day.date, workout_id: "threshold-overunder", targets: { over: 108 }, reason: "Race-like" });
    expect(result.proposal?.change).toMatchObject({ kind: "workout", template: "threshold-overunder", tweaks: { over: 1.08 } });
    expect(result.proposal?.summary).toContain("Over-unders");
    expect(runTool(data, "propose_workout", { date: day.date, workout_id: "threshold-overunder", targets: { over: 200 }, reason: "x" }).content).toMatch(/Error/);
  });
});

describe("weekly workout picks", () => {
  const keyDays = () => data.state.basePlan.weeks.flatMap((w) => w.days).filter((d) => d.date >= data.state.today && d.role === "key");

  it("keeps the coach's picks that fit and turns away ones from the wrong zone", async () => {
    const [day] = keyDays();
    const zone = day.session!.zone;
    const right = zone === "sweetSpot" ? "sweetSpot-surges" : zone === "threshold" ? "threshold-overunder" : zone === "tempo" ? "tempo-bursts" : zone === "vo2max" ? "vo2max-3030" : "anaerobic-attacks";
    const wrong = zone === "vo2max" ? "threshold-overunder" : "vo2max-3030";
    const replies = [
      call("pick_workout", { date: day.date, workout_id: wrong, reason: "x" }),
      call("pick_workout", { date: day.date, workout_id: right, reason: "Race-like surges for the cross season." }),
      say("Surges this week to get ready for racing."),
    ];
    const seen: ChatMessage[][] = [];
    const reply = await planWeek(async (messages) => (seen.push([...messages]), replies.shift()!), data, [day]);
    expect(seen[1].at(-1)!.content).toMatch(/^Error: .*pick a/);
    expect(reply.picks).toEqual([{ date: day.date, template: right, tweaks: undefined, reason: "Race-like surges for the cross season." }]);
    expect(reply.message).toContain("Surges");
    expect(seen[0][1].content).toContain(day.date);
  });

  it("only offers reading tools and pick_workout", async () => {
    let tools: { function: { name: string } }[] = [];
    await planWeek(async (_m, t) => ((tools = t as typeof tools), say("Done.")), data, keyDays().slice(0, 1));
    const names = tools.map((t) => t.function.name);
    expect(names).toContain("pick_workout");
    expect(names).toContain("get_workouts");
    expect(names.some((n) => n.startsWith("propose_"))).toBe(false);
  });
  it("writes last week's review in the same run, from the engine's numbers", async () => {
    const review = {
      start: "2026-10-19",
      end: "2026-10-25",
      planned: 400,
      done: 350,
      rides: 4,
      seconds: 5.5 * 3600,
      marks: { done: 3, partial: 1, moved: 0, missed: 1, unplanned: 0 },
      felt: { tooEasy: 0, right: 2, tooHard: 1, failed: 0 },
      rpe: 7,
      levels: [{ zone: "threshold" as const, from: 3, to: 3.6 }],
      fitness: 55,
      fitnessChange: 2,
      form: -4,
    };
    const seen: ChatMessage[][] = [];
    const reply = await planWeek(async (messages) => (seen.push([...messages]), say("350 of 400 TSS last week.")), data, [], "", {}, review);
    const prompt = seen[0][1].content as string;
    expect(prompt).toMatch(/No key days to plan/);
    expect(JSON.parse(prompt.split("Last week's review:\n")[1])).toMatchObject({ plannedStress: 400, doneStress: 350, hours: 5.5, howSessionsFelt: { "About right": 2, "Too hard": 1 }, levelsMoved: [{ zone: "Threshold", from: 3, to: 3.6 }] });
    expect(reply.message).toBe("350 of 400 TSS last week.");
  });
});

describe("app tools in the chat", () => {
  it("runs the app's tools when the shell has registered them, and keeps their proposals", async () => {
    const { registerAppTools } = await import("./app-tools");
    const ran: string[] = [];
    registerAppTools({
      tools: [{ type: "function", function: { name: "check_app", description: "", parameters: { type: "object", properties: {} } } }],
      status: { check_app: "Checking the app" },
      apply: async () => "Done.",
      run: async (name) => {
        ran.push(name);
        return {
          content: "{}",
          proposal: { change: { kind: "app", setting: { setting: "power_source", value: "trainer" } }, summary: "Power source: trainer (now power meter)", reason: "", status: "pending" },
        };
      },
    });
    const offered: string[][] = [];
    const replies = [call("check_app", {}), say("Turn simulated gear off.")];
    const statuses: string[] = [];
    const reply = await coachChat(
      async (_m, tools) => (offered.push((tools as { function: { name: string } }[]).map((t) => t.function.name)), replies.shift()!),
      data,
      [{ role: "user", content: "My KICKR doesn't show up" }],
      "",
      { onStatus: (s) => statuses.push(s) },
    );
    registerAppTools(null);
    expect(offered[0]).toContain("check_app");
    expect(ran).toEqual(["check_app"]);
    expect(statuses).toContain("Checking the app");
    expect(reply.proposals[0].change).toEqual({ kind: "app", setting: { setting: "power_source", value: "trainer" } });
  });
});
