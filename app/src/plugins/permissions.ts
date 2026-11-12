// What a plugin may read on this device, and what an update changes, in plain words for the
// install and update screens (design doc review S3 to S7). Pure, so the screens and tests agree.
import type { MetricGroup } from "@shared/sdk";
import type { PluginManifest } from "./manifest";

/** The rider-facing name and contents of each permission group. */
export const GROUP_WORDS: Record<MetricGroup, { name: string; what: string; health?: boolean }> = {
  live: { name: "Live ride", what: "power, cadence, heart rate and speed while you ride" },
  rides: { name: "Rides", what: "your past rides' power, heart rate and totals" },
  fitness: { name: "Fitness and plan", what: "fitness, fatigue, form and your planned workouts" },
  profile: { name: "Profile", what: "FTP, weight and heart rate zones" },
  recovery: { name: "Recovery, which is health data", what: "sleep, HRV and resting heart rate", health: true },
  location: { name: "Where you ride", what: "GPS routes, which can show where you live" },
};

/** Groups granted without a separate tick. Location is always its own opt-in, off by default (S5). */
export const OPT_IN_GROUPS: readonly MetricGroup[] = ["location"];

/** What the rider approves on this device. */
export interface Grant {
  /** The exact package approved; a different one doesn't run until approved again (S6, S7). */
  sha256: string;
  read: MetricGroup[];
  enabled: boolean;
  coachVisible: boolean;
  switchedOff?: string | null;
}

export interface InstallChoices {
  /** Also allow the opt-in groups it asks for (location). Off unless ticked. */
  location?: boolean;
  /** Let the coach see its numbers. Off unless ticked. */
  coachVisible?: boolean;
}

/** The groups granted at install for these choices. */
export function grantedGroups(m: PluginManifest, choices: InstallChoices): MetricGroup[] {
  return m.permissions.read.filter((g) => !OPT_IN_GROUPS.includes(g) || (g === "location" && choices.location === true));
}

/** The manifest the sandbox runs with: its read list cut to what this device granted. */
export function grantedManifest(m: PluginManifest, read: readonly MetricGroup[]): PluginManifest {
  return { ...m, permissions: { read: m.permissions.read.filter((g) => read.includes(g)) } };
}

export type PluginState =
  /** Approved here, this exact package, switched on. */
  | "on"
  /** Approved here and switched off by the rider. */
  | "off"
  /** Lactic switched it off (crashes, running late); `switchedOff` says why. */
  | "switched-off"
  /** No approval on this device: it came by sync or a restored backup. */
  | "needs-approval"
  /** Approved here, but the package changed (synced update): approve the new one first. */
  | "changed";

export function pluginState(sha256: string, grant: Grant | null): PluginState {
  if (!grant) return "needs-approval";
  if (grant.sha256 !== sha256) return "changed";
  if (grant.switchedOff) return "switched-off";
  return grant.enabled ? "on" : "off";
}

export interface UpdateChanges {
  from: string;
  to: string;
  /** Newer, same, or older than what's installed. */
  direction: "newer" | "same" | "older";
  /** The author changed: the usual sign a plugin changed hands. */
  author: { from: string; to: string } | null;
  newReads: MetricGroup[];
  droppedReads: MetricGroup[];
  newWidgets: string[];
  newFields: string[];
  newMetrics: string[];
  /** Nothing the rider needs to look at beyond the version. */
  quiet: boolean;
}

function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** What installing `next` over `prev` changes, for the update screen. */
export function updateChanges(prev: PluginManifest, next: PluginManifest): UpdateChanges {
  const cmp = compareVersions(next.version, prev.version);
  const titles = (list: { id: string; title: string }[], old: { id: string }[]) => list.filter((c) => !old.some((o) => o.id === c.id)).map((c) => c.title);
  const prevAuthor = prev.author ?? "";
  const nextAuthor = next.author ?? "";
  const changes: UpdateChanges = {
    from: prev.version,
    to: next.version,
    direction: cmp > 0 ? "newer" : cmp < 0 ? "older" : "same",
    author: prevAuthor !== nextAuthor ? { from: prevAuthor || "no one named", to: nextAuthor || "no one named" } : null,
    newReads: next.permissions.read.filter((g) => !prev.permissions.read.includes(g)),
    droppedReads: prev.permissions.read.filter((g) => !next.permissions.read.includes(g)),
    newWidgets: titles(next.contributes.widgets, prev.contributes.widgets),
    newFields: titles(next.contributes.fields, prev.contributes.fields),
    newMetrics: next.publishes.filter((p) => !prev.publishes.some((o) => o.id === p.id)).map((p) => p.label),
    quiet: false,
  };
  changes.quiet = !changes.author && changes.newReads.length === 0 && changes.direction === "newer";
  return changes;
}

/** The grant after the rider taps Update: new groups are approved by that tap, location only if ticked. A plugin the rider had switched off stays off. */
export function updatedGrant(prev: Grant | null, next: PluginManifest, sha256: string, choices: InstallChoices): Grant {
  const kept = prev ? prev.read.filter((g) => next.permissions.read.includes(g)) : [];
  const fresh = next.permissions.read.filter((g) => !(prev?.read ?? []).includes(g) && (!OPT_IN_GROUPS.includes(g) || choices.location === true));
  const read = next.permissions.read.filter((g) => kept.includes(g) || fresh.includes(g));
  return { sha256, read, enabled: prev ? prev.enabled || Boolean(prev.switchedOff) : true, coachVisible: choices.coachVisible ?? prev?.coachVisible ?? false, switchedOff: null };
}
