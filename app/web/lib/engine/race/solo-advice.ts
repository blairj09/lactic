// What to work on, and what went well, from a solo race report: plain sentences with the engine's
// numbers in them, most important first. Distances go through the caller's formatter so they read in
// the rider's units. The thresholds are the engine's rules of thumb, stated in the text so the rider
// can see why a line shows up.

import { formatClock } from "./results";
import type { SoloComparison, SoloReport, SoloSection } from "./solo";

export type SoloArea = "start" | "fade" | "durability" | "climbs" | "heart" | "stops" | "fueling" | "past";

export interface SoloAdvice {
  area: SoloArea;
  tone: "work" | "strength";
  title: string;
  detail: string;
  /** Sections to highlight on the profile. */
  sections: number[];
  /** How much it matters, for ordering: roughly minutes at stake. */
  weight: number;
}

export interface SoloFormatters {
  /** Meters from the start → "km 122" / "mile 76". */
  at: (meters: number) => string;
  /** Meters → "325 km". */
  distance: (meters: number) => string;
}

const mins = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`;
};
const pct = (x: number) => `${Math.round(x)}%`;

/** The climbs worth comparing: at least 100 m up. */
export const bigClimbs = (r: SoloReport) => r.sections.filter((s) => s.kind === "climb" && s.gain >= 100);

/** Your fastest past edition that rode the whole route, if any. */
export function bestPast(r: SoloReport): SoloComparison | null {
  const full = r.comparisons.filter((c) => c.past && c.elapsed !== null);
  return full.length ? full.reduce((a, b) => ((b.elapsed as number) < (a.elapsed as number) ? b : a)) : null;
}

export function soloAdvice(r: SoloReport, fmt: SoloFormatters): SoloAdvice[] {
  const out: SoloAdvice[] = [];
  const hours = r.moving / 3600;
  const q = r.quarters;
  const climbs = bigClimbs(r);

  // The start: the first hour against the whole race.
  if (r.firstHour?.intensity != null && r.intensity !== null && hours >= 4) {
    const over = r.firstHour.intensity - r.intensity;
    if (over >= 0.08) {
      out.push({
        area: "start",
        tone: "work",
        title: "Start the day easier",
        detail: `Your first hour was at ${Math.round(r.firstHour.intensity * 100)}% of FTP (normalized ${r.firstHour.np} W) against ${Math.round(r.intensity * 100)}% for the whole ${mins(r.moving)} of riding. If that was holding a wheel in the bunch it may have been worth it; otherwise, on a day this long an opening hour within about 5% of the race's own intensity costs little time and leaves more for the last third.`,
        sections: r.sections.filter((s) => s.startClock < 3600 + (r.stops[0]?.seconds ?? 0)).map((s) => s.id),
        weight: 30 * over * 10,
      });
    }
  }

  // Fade: the last quarter of riding against the first.
  if (q.length === 4 && q[0].watts && q[3].watts) {
    const ratio = q[3].watts / q[0].watts;
    const hr = q[0].hr && q[3].hr && q[3].hr < q[0].hr - 8 ? ` Heart rate fell with it (${q[0].hr} to ${q[3].hr} bpm): when both drop together late in a long day, it's usually tired legs or an empty tank rather than a choice to ease off.` : "";
    if (ratio < 0.85) {
      out.push({
        area: "fade",
        tone: "work",
        title: "You faded in the second half",
        detail: `Average power fell from ${q[0].watts} W in the first quarter (${fmt.at(q[0].from)}–${fmt.at(q[0].to).replace(/^\D+/, "")}) to ${q[3].watts} W in the last (${pct(ratio * 100)} of it).${q[3].gain < q[0].gain ? ` The last quarter climbed less (${q[3].gain} m against ${q[0].gain} m), which explains some of it.` : ""}${hr}`,
        sections: [],
        weight: (1 - ratio) * 100,
      });
    } else if (ratio >= 0.93) {
      out.push({ area: "fade", tone: "strength", title: "You held your power all day", detail: `Your last quarter averaged ${q[3].watts} W, ${pct(ratio * 100)} of the first quarter's ${q[0].watts} W.`, sections: [], weight: 10 });
    }
  }

  // Durability: best 20 minutes once tired.
  const bands = r.durability.bands.filter((b) => b.pct20 !== null);
  const fresh = r.durability.fresh;
  if (fresh?.best20 && bands.length >= 3) {
    const drop = bands.find((b) => (b.pct20 as number) < 90);
    const full = bands.filter((b) => b.toKj - b.fromKj >= 900);
    const late = full[full.length - 1] ?? bands[bands.length - 1];
    if (drop && (late.pct20 as number) < 85) {
      out.push({
        area: "durability",
        tone: "work",
        title: "Build durability: your power once tired",
        detail: `Your best 20 minutes was ${fresh.best20} W ${fresh.from === "before" ? "in training before the race" : "while fresh"}. It dropped under 90% of that after ${drop.fromKj.toLocaleString("en-US")} kJ (from ${fmt.at(drop.from)}) and was ${late.best20} W (${late.pct20}%) between ${late.fromKj.toLocaleString("en-US")} and ${late.toKj.toLocaleString("en-US")} kJ. Long rides with hard efforts in their last hours (say 2 × 20 min at 85–90% of FTP after 3 hours) train exactly this.`,
        sections: [],
        weight: (100 - (late.pct20 as number)) * 0.8,
      });
    } else if ((late.pct20 as number) >= 90) {
      out.push({ area: "durability", tone: "strength", title: "Durable to the end", detail: `Even after ${late.fromKj.toLocaleString("en-US")} kJ your best 20 minutes was ${late.best20} W, ${late.pct20}% of your fresh ${fresh.best20} W.`, sections: [], weight: 10 });
    }
  }

  // The climbs in order.
  const powered = climbs.filter((c) => c.watts !== null && c.moving >= 600);
  if (powered.length >= 2) {
    const first = powered[0];
    const last = powered[powered.length - 1];
    const ratio = (last.watts as number) / (first.watts as number);
    const list = powered.map((c) => `${c.label} ${c.watts} W${c.pctFtp !== null ? ` (${c.pctFtp}%)` : ""}`).join(", ");
    if (ratio < 0.85) {
      out.push({
        area: "climbs",
        tone: "work",
        title: `${last.label} cost you most`,
        detail: `You climbed ${first.label} at ${first.watts} W and ${last.label} at ${last.watts} W (${pct(ratio * 100)}), arriving at it with ${last.kjBefore.toLocaleString("en-US")} kJ already done. In order: ${list}. ${first.pctFtp !== null && first.pctFtp > 75 && hours >= 6 ? `On a ${Math.round(hours)}-hour day the first big climb at ${first.pctFtp}% of FTP is where the later climbs were lost; around 70–75% keeps more for the last ones.` : "Pace the early climbs a little easier and the late ones hold up."}`,
        sections: [first.id, last.id],
        weight: (1 - ratio) * 80,
      });
    } else {
      out.push({ area: "climbs", tone: "strength", title: "Your climbing held up", detail: `In order: ${list}.`, sections: powered.map((c) => c.id), weight: 8 });
    }
  }

  // Heart rate drifting away from power.
  if (r.decoupling !== null && r.decoupling >= 10) {
    out.push({
      area: "heart",
      tone: "work",
      title: "Your heart rate drifted from your power",
      detail: `Power per heartbeat fell ${r.decoupling}% from the first half to the second (under 5% is what a well-paced, well-fueled long day looks like). Heat, dehydration and running low on carbohydrate all show up like this.`,
      sections: [],
      weight: r.decoupling * 0.6,
    });
  }

  // Stops.
  if (r.stops.length && r.stopped >= 300) {
    const longest = r.stops.reduce((a, b) => (b.seconds > a.seconds ? b : a));
    const past = bestPast(r);
    const vs = past?.stopped != null ? ` In ${past.name} you stopped for ${mins(past.stopped)}.` : "";
    const lost = past?.stopped != null ? r.stopped - past.stopped : r.stopped - 60 * r.stops.length;
    out.push({
      area: "stops",
      tone: lost > 300 ? "work" : "strength",
      title: lost > 300 ? `${mins(r.stopped)} stopped` : "Quick stops",
      detail: `You stopped ${r.stops.length} time${r.stops.length === 1 ? "" : "s"} for ${mins(r.stopped)} in all; the longest was ${mins(longest.seconds)} at ${longest.place ?? fmt.at(longest.at)}.${vs}${lost > 300 ? " Stopped time is the cheapest time in a long race: a plan for each stop (bottles handed up, food in a bag ready) saves minutes without a single watt." : ""}`,
      sections: [],
      weight: Math.max(0, lost) / 60,
    });
  }

  // Fueling: the longest stretch between stops.
  if (r.legs.length >= 2 && r.kj !== null) {
    const longest = r.legs.reduce((a, b) => (b.moving > a.moving ? b : a));
    if (longest.moving >= 2 * 3600) {
      out.push({
        area: "fueling",
        tone: "work",
        title: `Carry enough for ${mins(longest.moving)}`,
        detail: `Your longest stretch without stopping was ${longest.fromName} to ${longest.toName}: ${fmt.distance(longest.to - longest.from)} and ${mins(longest.moving)}, ${longest.kj.toLocaleString("en-US")} kJ of work (about as many kcal). At 60–90 g of carbohydrate an hour that stretch needs ${Math.round((longest.moving / 3600) * 60)}–${Math.round((longest.moving / 3600) * 90)} g on the bike. The whole day was ${r.kj.toLocaleString("en-US")} kJ.`,
        sections: [],
        weight: longest.moving / 3600,
      });
    }
  }

  // Against your own past editions.
  const past = bestPast(r);
  if (past && past.finishGap !== null) {
    const known = past.sections.filter((x): x is typeof x & { delta: number } => x.delta !== null);
    const lost = [...known].sort((a, b) => b.delta - a.delta).filter((x) => x.delta > 60).slice(0, 2);
    const gained = [...known].sort((a, b) => a.delta - b.delta).filter((x) => x.delta < -60).slice(0, 1);
    const label = (id: number) => describeSection(r.sections[id], fmt);
    const slower = past.finishGap > 0;
    // Where you rode much harder than last time for little or nothing: the match you burned.
    const burned = past.sections
      .filter((x) => x.watts !== null && x.delta !== null && r.sections[x.id].watts !== null && r.sections[x.id].kind !== "descent" && r.sections[x.id].moving >= 600 && x.delta > -60)
      .map((x) => ({ x, extra: (r.sections[x.id].watts as number) - (x.watts as number) }))
      .filter((b) => b.extra >= 25)
      .sort((a, b) => b.extra - a.extra)[0];
    const burnedLine = burned
      ? ` You rode ${describeSection(r.sections[burned.x.id], fmt)} at ${r.sections[burned.x.id].watts} W against ${burned.x.watts} W in ${past.name}, and ${(burned.x.delta as number) < 0 ? `gained only ${Math.round(-(burned.x.delta as number))} s` : "gained nothing"} for it.`
      : "";
    out.push({
      area: "past",
      tone: slower ? "work" : "strength",
      title: slower ? `${mins(past.finishGap)} slower than ${past.name}` : `${mins(-past.finishGap)} faster than ${past.name}`,
      detail: `${lost.length ? `Most of it went on ${lost.map((x) => `${label(x.id)} (${mins(x.delta)})`).join(" and ")}.` : ""}${gained.length ? ` You gained on ${label(gained[0].id)} (${mins(-gained[0].delta)}).` : ""}${past.stopped !== null ? ` Stopped: ${mins(r.stopped)} against ${mins(past.stopped)}.` : ""}${past.np !== null && r.np !== null ? ` Normalized power: ${r.np} W against ${past.np} W.` : ""}${burnedLine}`.trim(),
      sections: lost.map((x) => x.id),
      weight: Math.abs(past.finishGap) / 60,
    });
  }

  return out.sort((a, b) => (a.tone === b.tone ? b.weight - a.weight : a.tone === "work" ? -1 : 1));
}

export function describeSection(s: SoloSection, fmt: SoloFormatters): string {
  if (s.kind === "flat") return `${fmt.at(s.from)}–${fmt.at(s.to).replace(/^\D+/, "")}`;
  return s.label;
}

export { formatClock };
