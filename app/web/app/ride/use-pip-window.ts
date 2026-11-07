"use client";

import { useCallback, useEffect, useState } from "react";

// Chrome's Document Picture-in-Picture: an always-on-top window that can hold any HTML. It floats
// over other apps on the same Space, but not over an app in macOS full screen (its own Space).
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function usePipWindow() {
  const [supported, setSupported] = useState(false);
  const [pip, setPip] = useState<Window | null>(null);

  useEffect(() => setSupported("documentPictureInPicture" in window), []);

  /** Must be called from a user gesture (a click). */
  const open = useCallback(async (width: number, height: number) => {
    const api = window.documentPictureInPicture;
    if (!api) return null;
    if (api.window) return api.window;
    const win = await api.requestWindow({ width, height });
    copyStyles(win.document);
    // The font is set up as a class on <html>; the theme choice (data-theme) follows the page's.
    const html = win.document.documentElement;
    html.className = document.documentElement.className;
    const syncTheme = () => {
      const theme = document.documentElement.dataset.theme;
      if (theme) html.dataset.theme = theme;
      else delete html.dataset.theme;
    };
    syncTheme();
    const watch = new MutationObserver(syncTheme);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    win.document.title = "My Coach";
    win.addEventListener(
      "pagehide",
      () => {
        watch.disconnect();
        setPip(null);
      },
      { once: true },
    );
    setPip(win);
    return win;
  }, []);

  const close = useCallback(() => window.documentPictureInPicture?.window?.close(), []);

  // Close the overlay with the page, so it doesn't linger with stale numbers.
  useEffect(() => close, [close]);

  return { supported, pip, open, close };
}

/** The PiP window starts blank, so it gets a copy of the page's styles (Tailwind included). */
function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      target.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
}
