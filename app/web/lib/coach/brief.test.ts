import { describe, expect, it } from "vitest";
import { briefStale, type BriefInputs } from "./chat";
import type { StoredMessage } from "./store";

const brief = (meta: Record<string, unknown>, proposals: StoredMessage["proposals"] = []): StoredMessage => ({
  id: "b",
  conversationId: null,
  role: "assistant",
  kind: "brief",
  day: "2026-10-30",
  content: "Morning.",
  proposals,
  meta,
  createdAt: "2026-10-30T14:00:00Z",
});

const day = { form: 3, session: "event:art-dye", signals: [] as string[] };
const inputs = (i: Partial<BriefInputs>): BriefInputs => ({ recovery: false, weighed: false, checkin: null, ...day, ...i });

describe("briefStale", () => {
  it("writes a brief when there's none, and again when recovery or a weigh-in arrives", () => {
    expect(briefStale(null, inputs({}))).toBe(true);
    expect(briefStale(brief({ recovery: true, weighed: true, ...day }), inputs({ recovery: true, weighed: true }))).toBe(false);
    expect(briefStale(brief({ recovery: false, ...day }), inputs({ recovery: true }))).toBe(true);
    expect(briefStale(brief({ recovery: true, ...day }), inputs({ recovery: true, weighed: true }))).toBe(true);
    expect(briefStale(brief({ recovery: true, ...day }), inputs({}))).toBe(false);
  });

  it("rewrites when rides move your form or today's session changes, so it matches Today", () => {
    expect(briefStale(brief({ recovery: true }), inputs({ recovery: true }))).toBe(true);
    expect(briefStale(brief({ ...day, form: -19 }), inputs({}))).toBe(true);
    expect(briefStale(brief({ ...day, form: 2 }), inputs({}))).toBe(false);
    expect(briefStale(brief({ ...day, session: "rest" }), inputs({}))).toBe(true);
  });

  it("rewrites when the recovery signs change, so a since-corrected sleep debt doesn't linger", () => {
    expect(briefStale(brief({ recovery: true, ...day, signals: ["sleepDebt"] }), inputs({ recovery: true }))).toBe(true);
    expect(briefStale(brief({ recovery: true, ...day }), inputs({ recovery: true, signals: ["hrvLow"] }))).toBe(true);
    const { signals: _, ...older } = day;
    expect(briefStale(brief({ recovery: true, ...older }), inputs({ recovery: true }))).toBe(true);
  });

  it("keeps a brief whose proposals you've acted on", () => {
    const acted = brief({ recovery: false }, [{ change: { kind: "reset", date: "2026-10-31" }, summary: "", reason: "", status: "applied" }]);
    expect(briefStale(acted, inputs({ recovery: true, weighed: true }))).toBe(false);
  });

  it("rewrites when you say how you feel, even after acting on its proposals", () => {
    const at = "2026-10-30T14:05:00Z";
    expect(briefStale(brief({ recovery: true, ...day }), inputs({ recovery: true, checkin: at }))).toBe(true);
    expect(briefStale(brief({ recovery: true, ...day, checkin: at }), inputs({ recovery: true, checkin: at }))).toBe(false);
    const acted = brief({ ...day }, [{ change: { kind: "reset", date: "2026-10-31" }, summary: "", reason: "", status: "applied" }]);
    expect(briefStale(acted, inputs({ checkin: at }))).toBe(true);
  });

  it("rewrites when a later recovery score moves the engine's pick, but not once today is chosen", () => {
    expect(briefStale(brief({ recovery: true, ...day, recommended: "asPlanned" }), inputs({ recovery: true, recommended: "easier" }))).toBe(true);
    expect(briefStale(brief({ recovery: true, ...day, recommended: "asPlanned" }), inputs({ recovery: true, recommended: "asPlanned" }))).toBe(false);
    expect(briefStale(brief({ recovery: true, ...day, recommended: "asPlanned" }), inputs({ recovery: true, recommended: null }))).toBe(false);
    expect(briefStale(brief({ recovery: true, ...day }), inputs({ recovery: true, recommended: "easier" }))).toBe(false);
  });
});
