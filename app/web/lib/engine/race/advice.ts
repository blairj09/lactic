// What to work on, and what went well, from a race comparison: plain sentences with the engine's
// numbers in them, ranked by the time at stake. Speeds go through the caller's formatter so they
// read in the rider's units.

import type { Comparison, RaceReport, SectionRow, SectionSpeeds } from "./report";
import type { Section, SectionKind } from "./sections";
import { formatClock } from "./results";

export type AdviceArea = "start" | "incident" | "corners" | "climbs" | "straights" | "descents" | "slow" | "pacing";

export interface Advice {
  area: AdviceArea;
  /** Something to work on, or something that went well. */
  tone: "work" | "strength";
  title: string;
  detail: string;
  /** Time at stake over the race, seconds (time lost, or gained for a strength). */
  seconds: number;
  /** Sections to highlight on the map. */
  sections: number[];
}

/** A stretch of the lap where time went: neighbouring sections that each lost time. */
export interface Stretch {
  from: number;
  to: number;
  sections: number[];
  seconds: number;
  perLap: number;
}

export interface Formatters {
  /** m/s → "18.2 km/h" */
  speed: (mps: number) => string;
  /** m/s difference → "2.1 km/h" */
  speedDiff: (mps: number) => string;
}

const s1 = (x: number) => `${Math.abs(Math.round(x * 10) / 10)} s`;
const names = (rows: SectionRow[], sections: Section[], n = 2) =>
  rows
    .slice(0, n)
    .map((r) => `${sections[r.id].label} (${s1(r.total)})`)
    .join(" and ");

const kindRows = (c: Comparison, sections: Section[], kind: SectionKind) => c.sections.filter((r) => sections[r.id].kind === kind);

function avgSpeeds(rows: SectionRow[], which: "own" | "rival"): SectionSpeeds | null {
  const ok = rows.filter((r) => r.own && r.rival).map((r) => r[which] as SectionSpeeds);
  if (!ok.length) return null;
  const m = (f: (s: SectionSpeeds) => number) => ok.reduce((a, s) => a + f(s), 0) / ok.length;
  return { entry: m((s) => s.entry), min: m((s) => s.min), exit: m((s) => s.exit), avg: m((s) => s.avg) };
}

/** Where on the lap time went, biggest first: runs of neighbouring sections that each lost time. */
export function stretches(c: Comparison, sections: Section[], minSeconds = 3): Stretch[] {
  const laps = Math.max(1, ...c.sections.map((r) => r.lapsCompared));
  const out: Stretch[] = [];
  let run: Stretch | null = null;
  for (const r of c.sections) {
    const s = sections[r.id];
    if (r.total > 0.3) {
      if (!run) run = { from: s.from, to: s.to, sections: [], seconds: 0, perLap: 0 };
      run.to = s.to;
      run.sections.push(r.id);
      run.seconds += r.total;
    } else if (run) {
      out.push(run);
      run = null;
    }
  }
  if (run) out.push(run);
  return out
    .map((x) => ({ ...x, seconds: Math.round(x.seconds * 10) / 10, perLap: Math.round((x.seconds / laps) * 10) / 10 }))
    .filter((x) => x.seconds >= minSeconds)
    .sort((a, b) => b.seconds - a.seconds);
}

export function raceAdvice(report: RaceReport, c: Comparison, fmt: Formatters): Advice[] {
  const { sections } = report;
  const self = c.id === "best-lap";
  const who = self ? "your best lap" : c.name.split(" ")[0];
  const whose = self ? "your best lap" : `${who}'s`;
  const out: Advice[] = [];
  const laps = Math.max(1, ...c.sections.map((r) => r.lapsCompared));

  // One-off losses: a single lap at one place.
  for (const inc of c.incidents.slice(0, 2)) {
    const s = sections[inc.section];
    out.push({
      area: "incident",
      tone: "work",
      title: `Lap ${inc.lap}, ${s.label}: ${s1(inc.seconds)} in one go`,
      detail: `Other laps there cost ${inc.usual > 0 ? `about ${s1(inc.usual)}` : "nothing"}. That looks like a bad line, a dismount or a bobble rather than a lack of speed: walk or pre-ride that spot until the line is automatic.`,
      seconds: round1(inc.seconds - Math.max(0, inc.usual)),
      sections: [inc.section],
    });
  }

  // The first lap, beyond what the other laps cost.
  const first = c.laps[0];
  const rest = c.laps.slice(1).filter((l) => l.delta !== null);
  if (!self && first?.delta != null && rest.length) {
    const usual = rest.reduce((a, l) => a + (l.delta as number), 0) / rest.length;
    const extra = first.delta - usual - (c.incidents.find((i) => i.lap === 1)?.seconds ?? 0);
    if (extra >= 4) {
      const field = report.field?.laps[0];
      out.push({
        area: "start",
        tone: "work",
        title: "Start harder and fight for position on lap 1",
        detail: `Lap 1 cost ${s1(first.delta)} against ${who}, where the other laps averaged ${s1(usual)}${field ? `; your lap 1 was ${ordinal(field.rank)} of ${field.of} in the field` : ""}. In cyclocross the first lap sets where you ride all race: practise race starts and the first minute flat out, and pick your line into the first corners before the gun.`,
        seconds: Math.round(extra * 10) / 10,
        sections: [],
      });
    }
  }

  // Corners.
  const corners = kindRows(c, sections, "corner").filter((r) => r.lapsCompared > 0);
  const cornerTotal = corners.reduce((a, r) => a + r.total, 0);
  const lostCorners = corners.filter((r) => r.total > 0.3).sort((a, b) => b.total - a.total);
  if (cornerTotal >= 3 || (lostCorners[0]?.total ?? 0) >= 4) {
    const o = avgSpeeds(lostCorners, "own");
    const t = avgSpeeds(lostCorners, "rival");
    let title = "Hold more speed through the corners";
    let how = "";
    if (o && t) {
      const d = { entry: o.entry - t.entry, min: o.min - t.min, exit: o.exit - t.exit };
      const worst = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
      if (worst === "min") {
        how = ` Your slowest point in them was ${fmt.speedDiff(-d.min)} below ${whose}: brake earlier and in a straight line, then let the bike roll through the apex.`;
      } else if (worst === "exit") {
        title = "Get on the power sooner out of corners";
        how = ` You left them ${fmt.speedDiff(-d.exit)} slower than ${who}: look to the exit, and stand up and sprint the first few pedal strokes.`;
      } else {
        title = "Carry more speed into the corners";
        how = ` You arrived ${fmt.speedDiff(-d.entry)} slower than ${who}: brake later and harder, and only once.`;
      }
    }
    out.push({
      area: "corners",
      tone: "work",
      title,
      detail: `${lossLine(cornerTotal, lostCorners, sections, "corners", who)}${how}`,
      seconds: round1(Math.max(cornerTotal, lostCorners[0]?.total ?? 0)),
      sections: lostCorners.slice(0, 4).map((r) => r.id),
    });
  } else if (cornerTotal <= -3) {
    const won = corners.filter((r) => r.total < -0.3).sort((a, b) => a.total - b.total);
    out.push({
      area: "corners",
      tone: "strength",
      title: "Your cornering held up",
      detail: `You gained ${s1(cornerTotal)} on ${who} in corners over the race, most at ${names(won, sections)}.`,
      seconds: -cornerTotal,
      sections: won.slice(0, 3).map((r) => r.id),
    });
  }

  // Climbs.
  const climbs = kindRows(c, sections, "climb").filter((r) => r.lapsCompared > 0);
  const climbTotal = climbs.reduce((a, r) => a + r.total, 0);
  if (climbTotal >= 3) {
    const lost = climbs.filter((r) => r.total > 0.3).sort((a, b) => b.total - a.total);
    const o = avgSpeeds(lost, "own");
    const t = avgSpeeds(lost, "rival");
    const climbW = report.own.byKind.find((k) => k.kind === "climb")?.watts ?? null;
    const flatW = report.own.byKind.find((k) => k.kind === "straight")?.watts ?? null;
    const power = climbW !== null && flatW !== null ? ` You averaged ${climbW} W on the climbs and ${flatW} W on the straights${climbW < flatW * 1.15 ? ": the short climbs are where a hard effort pays most" : ""}.` : "";
    out.push({
      area: "climbs",
      tone: "work",
      title: "Put more power into the climbs",
      detail: `You lost ${s1(climbTotal)} on the climbs (${s1(climbTotal / laps)} a lap), most on ${names(lost, sections)}${o && t ? `, riding them ${fmt.speedDiff(t.avg - o.avg)} slower` : ""}.${power} Hit them with speed and go hard over the top: these are short, and you recover on the next straight.`,
      seconds: Math.round(climbTotal * 10) / 10,
      sections: lost.slice(0, 4).map((r) => r.id),
    });
  } else if (climbTotal <= -3) {
    out.push({ area: "climbs", tone: "strength", title: "You climbed well", detail: `You gained ${s1(climbTotal)} on ${who} on the climbs.`, seconds: -climbTotal, sections: climbs.filter((r) => r.total < 0).map((r) => r.id) });
  }

  // Straights.
  const straights = kindRows(c, sections, "straight").filter((r) => r.lapsCompared > 0);
  const straightTotal = straights.reduce((a, r) => a + r.total, 0);
  if (straightTotal >= 3) {
    const lost = straights.filter((r) => r.total > 0.3).sort((a, b) => b.total - a.total);
    const o = avgSpeeds(straights, "own");
    const t = avgSpeeds(straights, "rival");
    out.push({
      area: "straights",
      tone: "work",
      title: "Drive the straights harder",
      detail: `You lost ${s1(straightTotal)} on the straights (${s1(straightTotal / laps)} a lap)${o && t ? `, ${fmt.speedDiff(t.avg - o.avg)} slower on average` : ""}, most on ${names(lost, sections)}. Short, flat-out bursts out of each corner and onto each straight add up over a race: this is where race-pace intervals pay off.`,
      seconds: Math.round(straightTotal * 10) / 10,
      sections: lost.slice(0, 4).map((r) => r.id),
    });
  } else if (straightTotal <= -3) {
    out.push({ area: "straights", tone: "strength", title: "Strong on the straights", detail: `You gained ${s1(straightTotal)} on ${who} on the straights.`, seconds: -straightTotal, sections: [] });
  }

  // Slow spots: barriers, sand, run-ups.
  const slow = kindRows(c, sections, "slow").filter((r) => r.lapsCompared > 0);
  const slowTotal = slow.reduce((a, r) => a + r.total, 0);
  if (slowTotal >= 3 || (slow.filter((r) => r.total > 0).sort((a, b) => b.total - a.total)[0]?.total ?? 0) >= 4) {
    const lost = slow.filter((r) => r.total > 0.3).sort((a, b) => b.total - a.total);
    out.push({
      area: "slow",
      tone: "work",
      title: "Get through the slow spots faster",
      detail: `${lossLine(slowTotal, lost, sections, "the slow spots (barriers, sand, run-ups, tight off-camber)", who)} Smooth dismounts and remounts, or riding what others run, are free time.`,
      seconds: round1(Math.max(slowTotal, lost[0]?.total ?? 0)),
      sections: lost.slice(0, 4).map((r) => r.id),
    });
  }

  // Descents.
  const descents = kindRows(c, sections, "descent").filter((r) => r.lapsCompared > 0);
  const descentTotal = descents.reduce((a, r) => a + r.total, 0);
  if (descentTotal >= 3) {
    const lost = descents.filter((r) => r.total > 0.3).sort((a, b) => b.total - a.total);
    out.push({
      area: "descents",
      tone: "work",
      title: "Let it run on the descents",
      detail: `You lost ${s1(descentTotal)} going downhill, most on ${names(lost, sections)}. Stay off the brakes, pedal over the top, and keep pedalling where it's safe.`,
      seconds: Math.round(descentTotal * 10) / 10,
      sections: lost.slice(0, 4).map((r) => r.id),
    });
  }

  // Pacing, from your own laps.
  const own = report.own.laps.filter((l) => l.seconds !== null).map((l) => l.seconds as number);
  if (own.length >= 3 && !self) {
    const after = own.slice(1);
    const best = Math.min(...after);
    const last = own[own.length - 1];
    if (last === best) {
      const field = report.field?.laps[report.field.laps.length - 1];
      out.push({
        area: "pacing",
        tone: "strength",
        title: "You finished strong",
        detail: `Your last lap (${formatClock(last)}) was your fastest${field && field.rank === 1 ? `, and the fastest last lap in the field` : ""}. There was more in the tank earlier: some of that could have gone into lap 1 or the climbs.`,
        seconds: 0,
        sections: [],
      });
    } else if (last > best * 1.03) {
      out.push({
        area: "pacing",
        tone: "work",
        title: "You faded at the end",
        detail: `Your last lap (${formatClock(last)}) was ${s1(last - best)} slower than your best (${formatClock(best)}). Ease the first laps a touch, and fuel and hydrate before the start.`,
        seconds: Math.round((last - best) * 10) / 10,
        sections: [],
      });
    }
  }

  return out.sort((a, b) => (a.tone === b.tone ? b.seconds - a.seconds : a.tone === "work" ? -1 : 1));
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** "You lost 12 s in corners, most at…", or, when gains elsewhere cancel it out, the net and the worst places. */
function lossLine(net: number, lost: SectionRow[], sections: Section[], where: string, who: string): string {
  const gross = lost.reduce((a, r) => a + r.total, 0);
  if (net >= gross * 0.6) return `You lost ${s1(net)} in ${where}, most at ${names(lost, sections)}.`;
  if (net > 0) return `Taken together, ${where} cost you only ${s1(net)}, but a few cost much more: ${names(lost, sections, 3)}.`;
  return `Overall you were as quick as ${who} in ${where} (you gained ${s1(net)}), but a few cost you: ${names(lost, sections, 3)}.`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
export { ordinal };
