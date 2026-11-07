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
