// What each part of a workout is for (warm-up, effort 3 of 7 in set 2, recovery...), read from the
// segments alone so it works for plan structures, edited workouts and imported ones alike.

import type { Segment, Workout } from "./workout";

/** Targets from here up (tempo and harder) count as efforts; anything easier is riding between them. */
export const EFFORT_FROM = 0.76;

/** A gap this much longer than the shortest one separates sets rather than efforts. */
const SET_GAP_RATIO = 1.5;

const level = (s: Segment) => (s.kind === "steady" ? s.target : s.kind === "ramp" ? Math.max(s.from, s.to) : 0.5);
const easyWord = (s: Segment) => (level(s) < 0.56 ? "Recovery" : "Endurance");

/** One label per segment, in order. */
export function segmentRoles(workout: Workout): string[] {
  const segments = workout.segments;
  // Openers are part of the warm-up, not efforts.
  const isOpener = (s: Segment) => s.kind === "steady" && Boolean(s.opener);
  const hard = segments.map((s) => level(s) >= EFFORT_FROM && !isOpener(s));

  // Efforts: runs of consecutive hard segments.
  const efforts: { first: number; last: number }[] = [];
  hard.forEach((h, i) => {
    if (!h) return;
    const prev = efforts[efforts.length - 1];
    if (prev && prev.last === i - 1) prev.last = i;
    else efforts.push({ first: i, last: i });
  });

  const roles: string[] = segments.map((s) => easyWord(s));
  if (efforts.length === 0) {
    // Steady riding: name the ramps at either end.
    if (segments.length > 1 && segments[0].kind === "ramp") roles[0] = "Warm-up";
    segments.forEach((s, i) => isOpener(s) && (roles[i] = "Warm-up"));
    const end = segments.length - 1;
    if (end > 0 && segments[end].kind === "ramp") roles[end] = "Cool-down";
    return roles;
  }

  const firstHard = efforts[0].first;
  const lastHard = efforts[efforts.length - 1].last;
  const openerCount = segments.slice(0, firstHard).filter(isOpener).length;
  let openerNumber = 0;
  for (let i = 0; i < firstHard; i++) roles[i] = isOpener(segments[i]) ? `Warm-up · opener ${++openerNumber} of ${openerCount}` : "Warm-up";
  // The last segment (and any ramp) after the final effort is the cool-down; steady riding before it keeps its own name.
  for (let i = lastHard + 1; i < segments.length; i++) if (i === segments.length - 1 || segments[i].kind === "ramp") roles[i] = "Cool-down";

  // Gaps between efforts: the easy time from one effort's end to the next one's start.
  const gaps = efforts.slice(1).map((e, k) => {
    let seconds = 0;
    for (let i = efforts[k].last + 1; i < e.first; i++) seconds += segments[i].duration;
    return seconds;
  });
  const shortest = gaps.length ? Math.min(...gaps) : 0;
  const longest = gaps.length ? Math.max(...gaps) : 0;
  const splitsSets = gaps.length > 1 && longest >= shortest * SET_GAP_RATIO;
  const betweenSets = gaps.map((g) => splitsSets && g >= shortest * SET_GAP_RATIO);

  // Group efforts into sets.
  const sets: number[][] = [[0]];
  betweenSets.forEach((split, k) => (split ? sets.push([k + 1]) : sets[sets.length - 1].push(k + 1)));
  // Only call them sets when every set has more than one effort; otherwise they're just efforts.
  const useSets = sets.length > 1 && sets.every((s) => s.length > 1);
  const groups = useSets ? sets : [efforts.map((_, k) => k)];

  groups.forEach((group, s) => {
    group.forEach((k, n) => {
      const { first, last } = efforts[k];
      const single = efforts.length === 1;
      const name = single ? "Main set" : `Effort ${n + 1} of ${group.length}`;
      const set = useSets ? ` · set ${s + 1} of ${groups.length}` : "";
      const parts = last - first + 1;
      for (let i = first; i <= last; i++) roles[i] = `${name}${set}${parts > 1 ? ` · part ${i - first + 1} of ${parts}` : ""}`;
      // The easy riding after this effort, up to the next one.
      const next = efforts[k + 1];
      if (!next) return;
      const label = useSets && betweenSets[k] ? "Rest between sets" : null;
      for (let i = last + 1; i < next.first; i++) roles[i] = label ?? easyWord(segments[i]);
    });
  });
  return roles;
}
