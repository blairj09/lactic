// Moving the desktop window by its title bar. macOS's web view ignores CSS `app-region: drag`, so a
// press on a `.lactic-drag` area (the top bar, setup screens) asks Tauri to start a native window
// drag, and a double click there zooms the window like any Mac title bar. Controls inside it keep
// working as usual.

/** What the press landed on: anything with Element's `closest`. */
export type PressTarget = { closest(selector: string): unknown };

const CONTROLS = 'a, button, summary, input, select, textarea, label, [role="dialog"], [role="menu"], [contenteditable="true"], .lactic-no-drag';

/** Whether a left press on `target` should move the window. */
export function startsWindowDrag(target: PressTarget | null, button: number): boolean {
  if (button !== 0 || !target || typeof target.closest !== "function") return false;
  return target.closest(".lactic-drag") != null && target.closest(CONTROLS) == null;
}

export function installWindowDrag() {
  document.addEventListener("mousedown", (e) => {
    if (!startsWindowDrag(e.target as Element | null, e.button)) return;
    e.preventDefault();
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      return e.detail === 2 ? win.toggleMaximize() : win.startDragging();
    }).catch((err) => console.error("window drag", err));
  });
}
