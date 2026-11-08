// A picture of the screen the rider is on, for feedback. It draws the page itself (not the
// desktop), so it needs no screen-recording permission and never shows other apps. Anything marked
// data-feedback-ui (the feedback dialog and its markup editor) is left out.

import { domToBlob } from "modern-screenshot";

export const FEEDBACK_UI = "data-feedback-ui";

/** The visible part of the window as a PNG, or null if it can't be drawn. */
export async function captureScreen(): Promise<File | null> {
  try {
    const root = document.documentElement;
    const background = getComputedStyle(document.body).backgroundColor || getComputedStyle(root).backgroundColor;
    const blob = await domToBlob(root, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: background,
      style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
      filter: (node) => !(node instanceof Element && node.hasAttribute(FEEDBACK_UI)),
      timeout: 4000,
    });
    if (!blob) return null;
    return new File([blob], "screen.png", { type: blob.type || "image/png" });
  } catch {
    return null;
  }
}
