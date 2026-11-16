"use client";

import { useRef, useState } from "react";

export interface BrushOptions {
  /**
   * What a finger does. "inspect" (the default): touching or sliding along the chart reads the value
   * under the finger, the page still scrolls up and down, and a double tap calls `onReset`. "brush":
   * a finger drags out a selection like a mouse does (ride report charts).
   */
  touch?: "inspect" | "brush";
  /** Called with the pointer on press and move, to read the value under it. */
  onHover?: (e: React.PointerEvent<Element>) => void;
  /** Called when a mouse leaves the chart. A finger's reading stays after it lifts. */
  onLeave?: () => void;
  /** Back to the full view: a double click, or a double tap in "inspect" mode. */
  onReset?: () => void;
}

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

/**
 * Drag-to-select on a chart's plot area. Drag across the plot and let go to call `onSelect` with the
 * start and end as fractions (0 to 1) of the plot's width; a click without a drag selects nothing.
 * `selection` is the band being dragged, in the same fractions, for drawing. Spread `handlers` and
 * `className` on the element that takes the pointer.
 */
export function useBrush(
  plotLeft: number,
  plotWidth: number,
  onSelect?: (from: number, to: number) => void,
  { touch = "inspect", onHover, onLeave, onReset }: BrushOptions = {},
) {
  const [start, setStart] = useState<number | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const lastTap = useRef<{ at: number; x: number } | null>(null);

  const fraction = (e: React.PointerEvent<Element>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left - plotLeft) / plotWidth));
  };
  const brushes = (e: React.PointerEvent<Element>) => onSelect && (e.pointerType !== "touch" || touch === "brush");
  const clear = () => {
    setStart(null);
    setCurrent(null);
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent<Element>) => {
      if (e.button !== 0) return;
      onHover?.(e);
      if (!brushes(e)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setStart(fraction(e));
      setCurrent(fraction(e));
    },
    onPointerMove: (e: React.PointerEvent<Element>) => {
      // A finger only reads while it's down; a mouse reads as it passes.
      if (e.pointerType === "touch" && !e.buttons && start === null) return;
      onHover?.(e);
      if (start !== null) setCurrent(fraction(e));
    },
    onPointerUp: (e: React.PointerEvent<Element>) => {
      if (e.pointerType === "touch" && touch === "inspect") {
        const tap = lastTap.current;
        const now = e.timeStamp;
        if (tap && now - tap.at < DOUBLE_TAP_MS && Math.abs(e.clientX - tap.x) < DOUBLE_TAP_PX) {
          lastTap.current = null;
          onReset?.();
        } else {
          lastTap.current = { at: now, x: e.clientX };
        }
      }
      if (start === null) return;
      const end = fraction(e);
      clear();
      // Under 2% of the width is a click, not a selection.
      if (onSelect && Math.abs(end - start) * plotWidth >= 8) onSelect(Math.min(start, end), Math.max(start, end));
    },
    onPointerCancel: clear,
    onPointerLeave: (e: React.PointerEvent<Element>) => {
      if (e.pointerType !== "touch") onLeave?.();
    },
    onDoubleClick: () => onReset?.(),
  };

  const selection = start !== null && current !== null ? { from: Math.min(start, current), to: Math.max(start, current) } : null;
  // Inspecting leaves vertical swipes to the page, so a chart never traps scrolling.
  const className = `select-none ${touch === "brush" ? "touch-none" : "touch-pan-y"}`;
  return { selection, handlers, className, dragging: start !== null };
}
