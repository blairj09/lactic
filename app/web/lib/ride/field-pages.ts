// The ride field editor's changes to a layout's ride pages: set a slot, swap two, change a page's
// template, add, rename, move and delete pages, and split free ride or the overlay off the workout
// pages (or put them back to following). Each returns a new value and leaves its input alone, so
// the editor can keep every step for Undo.
//
// Pure, so it tests in Node.

import { PAGE_TEMPLATES, defaultLayout, type FieldRef, type Layout, type PageTemplate, type RidePage } from "../sdk/layout";
import type { FieldSetId } from "../sdk/layout-edit";

export type RideSets = Layout["ride"];

/** Pages per set, as the layout parser allows. */
export const MAX_PAGES = 8;

/** Whether a set uses the workout pages (review U4: one set by default). */
export const follows = (ride: RideSets, set: FieldSetId): boolean => set !== "workout" && ride[set] === "follow";

/** The pages a set shows. */
export function pagesOf(ride: RideSets, set: FieldSetId): RidePage[] {
  if (set === "workout") return ride.workout.pages;
  const s = ride[set];
  return s === "follow" ? ride.workout.pages : s.pages;
}

/** The ride sets with `set`'s pages replaced (a following set is split off by this). */
export function withPages(ride: RideSets, set: FieldSetId, pages: RidePage[]): RideSets {
  const next = structuredClone(ride);
  if (set === "workout") next.workout = { pages };
  else next[set] = { pages };
  return next;
}

/** Gives a set its own copy of the workout pages, to change separately. */
export const splitOff = (ride: RideSets, set: Exclude<FieldSetId, "workout">): RideSets => withPages(ride, set, structuredClone(ride.workout.pages));

/** Puts a set back to following the workout pages. */
export function follow(ride: RideSets, set: Exclude<FieldSetId, "workout">): RideSets {
  const next = structuredClone(ride);
  next[set] = "follow";
  return next;
}

function changePage(ride: RideSets, set: FieldSetId, page: number, change: (p: RidePage) => RidePage): RideSets {
  const pages = structuredClone(pagesOf(ride, set));
  if (!pages[page]) return ride;
  pages[page] = change(pages[page]);
  return withPages(ride, set, pages);
}

/**
 * Puts a field in a slot. A slot past the page's last field fills the first empty one instead, so
 * a page never has holes; null takes the field out and moves the later ones up.
 */
export function setSlot(ride: RideSets, set: FieldSetId, page: number, slot: number, field: FieldRef | null): RideSets {
  return changePage(ride, set, page, (p) => {
    const fields = [...p.fields];
    if (field === null) fields.splice(slot, 1);
    else if (slot < fields.length) fields[slot] = field;
    else if (fields.length < PAGE_TEMPLATES[p.template]) fields.push(field);
    return { ...p, fields };
  });
}

/** Swaps two filled slots (drag and drop, or Move earlier and later). */
export function swapSlots(ride: RideSets, set: FieldSetId, page: number, a: number, b: number): RideSets {
  return changePage(ride, set, page, (p) => {
    if (a === b || !p.fields[a] || !p.fields[b]) return p;
    const fields = [...p.fields];
    [fields[a], fields[b]] = [fields[b], fields[a]];
    return { ...p, fields };
  });
}

/** A new template keeps the fields that fit; Undo brings back any it drops. */
export const setTemplate = (ride: RideSets, set: FieldSetId, page: number, template: PageTemplate): RideSets =>
  changePage(ride, set, page, (p) => ({ ...p, template, fields: p.fields.slice(0, PAGE_TEMPLATES[template]) }));

export const renamePage = (ride: RideSets, set: FieldSetId, page: number, name: string): RideSets =>
  changePage(ride, set, page, (p) => ({ ...p, name: name.slice(0, 24) }));

/** A new, empty four-field page at the end, named "Page N". */
export function addPage(ride: RideSets, set: FieldSetId): RideSets {
  const pages = pagesOf(ride, set);
  if (pages.length >= MAX_PAGES) return ride;
  return withPages(ride, set, [...structuredClone(pages), { name: `Page ${pages.length + 1}`, template: "four", fields: [] }]);
}

/** Deletes a page; the last page can't go. */
export function deletePage(ride: RideSets, set: FieldSetId, page: number): RideSets {
  const pages = pagesOf(ride, set);
  if (pages.length < 2 || !pages[page]) return ride;
  return withPages(ride, set, structuredClone(pages.filter((_, i) => i !== page)));
}

/** Moves a page one place earlier (-1) or later (1). */
export function movePage(ride: RideSets, set: FieldSetId, page: number, step: 1 | -1): RideSets {
  const pages = structuredClone(pagesOf(ride, set));
  const to = page + step;
  if (!pages[page] || !pages[to]) return ride;
  [pages[page], pages[to]] = [pages[to], pages[page]];
  return withPages(ride, set, pages);
}

/** Lactic standard: one standard page, followed by free ride and the overlay. */
export const standardSets = (): RideSets => defaultLayout().ride;

/** Every field in every set, for working out values once a second. */
export function allFields(ride: RideSets): FieldRef[] {
  return (["workout", "free", "overlay"] as const).flatMap((s) => pagesOf(ride, s).flatMap((p) => p.fields));
}
