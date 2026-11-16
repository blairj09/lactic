// Tapping the tab you're already on, as on iOS and Android: from a page inside the tab (a ride, Plan →
// Workouts) it goes back to the tab's own page; on that page it scrolls to the top. Never mid-ride.

export type Retap = "none" | "root" | "top";

/** What a tap on the tab at `href` does, given where the rider is. `current` is the tab Nav says is open. */
export function retap({ href, current, pathname, search, riding }: { href: string; current: string; pathname: string; search: string; riding: boolean }): Retap {
  if (href !== current) return "none";
  if (riding) return "none";
  return pathname === href && (search === "" || search === "?") ? "top" : "root";
}

/** Scrolls the page to the top: smoothly, or in one jump when the rider asks for reduced motion. */
export function scrollToTop(win: Pick<Window, "scrollTo" | "matchMedia"> = window) {
  const reduce = win.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  win.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}
