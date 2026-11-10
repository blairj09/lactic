// Where you were. Each top-level screen (Today, Plan, Progress, Health) remembers the last place
// you had open in it, such as a ride opened from Progress or a range picked there, and every place
// remembers how far down it was scrolled. Coming back to a screen from Settings, Ride or another
// screen returns you there; tapping the screen you're already in goes to its top level.

import { useSyncExternalStore } from "react";

/** The top-level screen a path belongs to, or null for screens that aren't tabs (Settings, Ride). */
export function tabOf(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return "/";
  for (const tab of ["/plan", "/progress", "/health"]) if (pathname === tab || pathname.startsWith(`${tab}/`)) return tab;
  // A ride's page sits under Progress, where the ride list is.
  if (pathname.startsWith("/rides/")) return "/progress";
  return null;
}

const pathOf = (url: string) => url.split(/[?#]/)[0];

export class PlaceMemory {
  private last = new Map<string, string>();
  private scrolls = new Map<string, number>();

  /** Notes that `url` (a route path with its query) is open now. */
  visit(url: string) {
    const tab = tabOf(pathOf(url));
    if (tab) this.last.set(tab, url);
  }

  /** Where a link to `tab` should go when `currentPath` is open. */
  hrefFor(tab: string, currentPath: string): string {
    if (tabOf(currentPath) === tab) return tab;
    return this.last.get(tab) ?? tab;
  }

  saveScroll(url: string, y: number) {
    if (y > 0) this.scrolls.set(url, Math.round(y));
    else this.scrolls.delete(url);
  }

  scrollFor(url: string): number {
    return this.scrolls.get(url) ?? 0;
  }
}

export const places = new PlaceMemory();

/** The route open in the window now, with its query, read from the address (#/progress?from=…). */
export function currentUrl(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/") ? hash : "/";
}

// Nav links re-render when the open place changes.
let version = 0;
const listeners = new Set<() => void>();
export function placesChanged() {
  version++;
  for (const l of listeners) l();
}
export function usePlacesVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}
