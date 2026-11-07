"use client";

import { useState } from "react";

/**
 * Drag-to-select on a chart's plot area. Drag across the plot and let go to call `onSelect` with the
 * start and end as fractions (0 to 1) of the plot's width; a click without a drag selects nothing.
 * `selection` is the band being dragged, in the same fractions, for drawing.
 */
export function useBrush(plotLeft: number, plotWidth: number, onSelect?: (from: number, to: number) => void) {
  const [start, setStart] = useState<number | null>(null);
  const [current, setCurrent] = useState<number | null>(null);

  const fraction = (e: React.PointerEvent<Element>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - box.left - plotLeft) / plotWidth));
  };

  const handlers = onSelect
    ? {
        onPointerDown: (e: React.PointerEvent<Element>) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setStart(fraction(e));
          setCurrent(fraction(e));
        },
        onPointerMove: (e: React.PointerEvent<Element>) => {
          if (start !== null) setCurrent(fraction(e));
        },
        onPointerUp: (e: React.PointerEvent<Element>) => {
          if (start === null) return;
          const end = fraction(e);
          setStart(null);
          setCurrent(null);
          // Under 2% of the width is a click, not a selection.
          if (Math.abs(end - start) * plotWidth >= 8) onSelect(Math.min(start, end), Math.max(start, end));
        },
        onPointerCancel: () => {
          setStart(null);
          setCurrent(null);
        },
      }
    : {};

  const selection = start !== null && current !== null ? { from: Math.min(start, current), to: Math.max(start, current) } : null;
  return { selection, handlers, dragging: start !== null };
}
