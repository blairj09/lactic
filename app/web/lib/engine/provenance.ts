// Where a number came from, so the rider can tell a reading from a guess: measured (a test, a scale,
// something you entered), estimated (worked out by Lactic from your rides), or synced (sent by another
// app or service), with the day it's from.

import type { FtpChange } from "./activity";

export type ProvenanceKind = "measured" | "estimated" | "synced";

export const PROVENANCE_LABELS: Record<ProvenanceKind, string> = { measured: "Measured", estimated: "Estimated", synced: "Synced" };

export interface Provenance {
  kind: ProvenanceKind;
  /** YYYY-MM-DD the value is from. */
  date: string;
  /** How, in a few words: "ramp test", "your scale", "Apple Health"... */
  via: string;
}

const FTP_METHODS: Record<string, { kind: ProvenanceKind; via: string }> = {
  rampTest: { kind: "measured", via: "ramp test" },
  manual: { kind: "measured", via: "entered by you" },
  criticalPower: { kind: "estimated", via: "critical power from your rides" },
  twentyMinute: { kind: "estimated", via: "95% of your best 20 minutes" },
  intervals: { kind: "synced", via: "intervals.icu" },
  guess: { kind: "estimated", via: "a starting guess from your weight" },
};

/** Where today's FTP came from: the latest change on or before `today`. Null without history. */
export function ftpProvenance(history: FtpChange[], today: string): Provenance | null {
  const latest = history.filter((h) => h.effectiveDate <= today).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (!latest) return null;
  const known = latest.method ? FTP_METHODS[latest.method] : undefined;
  return { date: latest.effectiveDate, ...(known ?? { kind: "measured", via: "entered by you" }) };
}

/** Scales Lactic reads over Bluetooth (scale/models.ts), and sources that send weigh-ins from elsewhere. */
const SYNCED_WEIGHT: Record<string, string> = { intervals: "intervals.icu", apple_health: "Apple Health", shortcut: "Apple Health" };

/** A weigh-in: measured on a scale (or entered), else synced from where it came. */
export function weightProvenance(source: string | null | undefined, date: string): Provenance {
  const synced = source ? SYNCED_WEIGHT[source] : undefined;
  if (synced) return { kind: "synced", date, via: synced };
  return { kind: "measured", date, via: source === "manual" ? "entered by you" : "your scale" };
}

const SYNCED_NIGHT: Record<string, string> = { intervals: "intervals.icu", apple_health: "Apple Health", shortcut: "Apple Health", health_connect: "Health Connect" };

/** A night's HRV, resting heart rate and sleep: synced from the app that recorded them. */
export function nightProvenance(source: string | null | undefined, date: string): Provenance {
  return { kind: "synced", date, via: (source && SYNCED_NIGHT[source]) || "your watch" };
}

/** A figure Lactic works out from your rides, as of `date`. */
export const fromRides = (date: string, via = "from your rides"): Provenance => ({ kind: "estimated", date, via });

/** "Measured Nov 3 · ramp test", for a tooltip or a line under a number; "today" for today's date. */
export function describeProvenance(p: Provenance, today: string): string {
  const when = p.date === today ? "today" : new Date(`${p.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${PROVENANCE_LABELS[p.kind]} ${when} · ${p.via}`;
}

/** Where the FTP came from, as a line under its field in Settings: "Measured Sep 1 · ramp test". */
export function ftpSourceLine(history: FtpChange[], today: string): string | null {
  const source = ftpProvenance(history, today);
  return source ? describeProvenance(source, today) : null;
}
