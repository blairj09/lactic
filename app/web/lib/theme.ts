// Light / Dark / System appearance, kept per device in localStorage. The chosen theme is put on
// <html data-theme="light|dark"> by an inline script before first paint, so there's no flash;
// with no choice (System) the attribute is left off and the CSS follows prefers-color-scheme.

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "mycoach:theme";
export const THEME_COLORS = { light: "#f5f6f8", dark: "#000000" } as const;

export function parseTheme(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Runs in <head> before the page paints. Also exposes window.__applyTheme for the Settings control
 * and follows changes made in other tabs. Kept dependency-free: it's inlined as a string.
 */
export const themeScript = `(function(){
var K=${JSON.stringify(THEME_KEY)},C=${JSON.stringify(THEME_COLORS)};
function metas(t){var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++){var e=m[i];if(!e.dataset.media)e.dataset.media=e.getAttribute("media")||"";if(t==="system"){e.setAttribute("media",e.dataset.media);e.content=/dark/.test(e.dataset.media)?C.dark:C.light}else{e.removeAttribute("media");e.content=C[t]}}}
function apply(t){t=t==="light"||t==="dark"?t:"system";var r=document.documentElement;if(t==="system")delete r.dataset.theme;else r.dataset.theme=t;metas(t)}
function read(){try{return localStorage.getItem(K)}catch(e){return null}}
window.__applyTheme=apply;
apply(read());
document.addEventListener("DOMContentLoaded",function(){apply(read())});
window.addEventListener("storage",function(e){if(e.key===K)apply(e.newValue)});
})();`;

export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private mode: still applies for this page.
  }
  const apply = (window as Window & { __applyTheme?: (t: ThemeChoice) => void }).__applyTheme;
  if (apply) apply(choice);
  else if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

// High contrast, also per device: High, Standard, or System (follows the OS's Increase contrast,
// which WebKit reports as prefers-contrast: more). Resolved onto <html data-contrast="more">, which
// globals.css answers with the high contrast tokens in both light and dark.

export type ContrastChoice = "system" | "standard" | "high";

export const CONTRAST_KEY = "lactic:contrast";

export function parseContrast(value: unknown): ContrastChoice {
  return value === "standard" || value === "high" ? value : "system";
}

export function readContrast(): ContrastChoice {
  try {
    return parseContrast(localStorage.getItem(CONTRAST_KEY));
  } catch {
    return "system";
  }
}

/** Whether a choice means high contrast, given whether the system asks for more contrast. */
export function isHighContrast(choice: ContrastChoice, systemMore: boolean): boolean {
  return choice === "high" || (choice === "system" && systemMore);
}

const MORE_CONTRAST = "(prefers-contrast: more)";

function systemWantsMore(): boolean {
  try {
    return window.matchMedia(MORE_CONTRAST).matches;
  } catch {
    return false;
  }
}

export function applyContrast(choice: ContrastChoice = readContrast(), root: HTMLElement = document.documentElement) {
  if (isHighContrast(choice, systemWantsMore())) root.dataset.contrast = "more";
  else delete root.dataset.contrast;
}

export function setContrast(choice: ContrastChoice) {
  try {
    if (choice === "system") localStorage.removeItem(CONTRAST_KEY);
    else localStorage.setItem(CONTRAST_KEY, choice);
  } catch {
    // Private mode: still applies for this page.
  }
  applyContrast(choice);
}

let watching = false;

/**
 * Keeps this window's theme and contrast current: when the system's contrast setting changes, and
 * when another window (the ride overlay, Settings) changes either choice.
 */
export function watchAppearance() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  try {
    window.matchMedia(MORE_CONTRAST).addEventListener("change", () => applyContrast());
  } catch {
    // Old web views without matchMedia listeners: picked up on the next launch.
  }
  window.addEventListener("storage", (e) => {
    if (e.key === CONTRAST_KEY) applyContrast(parseContrast(e.newValue));
    if (e.key === THEME_KEY) setTheme(parseTheme(e.newValue));
  });
}
