"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows downward with its text instead of scrolling, up to maxRows, then scrolls.
 * Works controlled (resizes when value changes) or uncontrolled (resizes on input). It also refits
 * when its width changes, including when it first shows after mounting inside a hidden panel (a
 * hidden textarea measures 0 tall, which used to squash it to a sliver).
 */
export function AutoTextarea({ maxRows = 12, onInput, rows = 2, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = ref.current;
    // Hidden (display: none somewhere above): nothing to measure yet. The observer refits on show.
    if (!el || !el.getClientRects().length) return;
    const style = getComputedStyle(el);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const max = line * maxRows + padding + border;
    el.style.height = "auto";
    const needed = el.scrollHeight + border;
    el.style.height = `${Math.min(needed, max)}px`;
    el.style.overflowY = needed > max ? "auto" : "hidden";
  };

  useLayoutEffect(fit, [props.value, maxRows]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      // Only width changes the wrapping; our own height changes don't need a refit.
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [maxRows]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      {...props}
      style={{ resize: "none", ...props.style }}
    />
  );
}
