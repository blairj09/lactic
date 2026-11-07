"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A textarea that grows downward with its text instead of scrolling, up to maxRows, then scrolls.
 * Works controlled (resizes when value changes) or uncontrolled (resizes on input).
 */
export function AutoTextarea({ maxRows = 12, onInput, rows = 2, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const el = ref.current;
    if (!el) return;
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
