"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The app's dropdown: a drop-in for a native <select> that draws its own menu in the app's tokens
 * (light and dark), so no OS menu pops up. Write <option> children as you would for a <select>;
 * `onChange` gets the new value. A `name` posts the value with its form through a hidden input.
 *
 * Keyboard: Up/Down/Enter/Space open it; Up/Down/Home/End/PageUp/PageDown move; typing jumps to a
 * matching option; Enter/Space picks; Escape or Tab closes. Focus stays on the button
 * (aria-activedescendant), as the ARIA select-only combobox pattern does.
 */
export default function Select({
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  className = "",
  children,
  id,
  title,
  "aria-label": ariaLabel,
}: {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  /** The trigger's classes: pass the `input` style plus any size, as for a native select. */
  className?: string;
  children: React.ReactNode;
  id?: string;
  title?: string;
  "aria-label"?: string;
}) {
  const options = collectOptions(children);
  const [inner, setInner] = useState(() => (defaultValue !== undefined ? String(defaultValue) : options.find((o) => !o.disabled)?.value ?? ""));
  const current = value !== undefined ? String(value) : inner;
  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = options[selectedIndex] ?? options[0];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Placement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i;
    return from;
  };
  const first = () => step(-1, 1);
  const last = () => step(options.length, -1);

  const measure = () => {
    const el = trigger.current;
    if (!el) return;
    setPlace(placement(el.getBoundingClientRect(), options.length));
  };

  const show = (at?: number) => {
    const el = trigger.current;
    if (!el || disabled) return;
    setHost((el.closest("dialog") as HTMLElement | null) ?? document.body);
    measure();
    setActive(at ?? (enabled(selectedIndex) ? selectedIndex : first()));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (i: number) => {
    if (!enabled(i)) return;
    const next = options[i].value;
    if (value === undefined) setInner(next);
    if (next !== current) onChange?.(next);
    hide();
  };

  /** Typeahead: letters typed within a second build a prefix; the next option that starts with it wins. */
  const seek = (key: string) => {
    const now = Date.now();
    const text = now - typed.current.at < 1000 ? typed.current.text + key.toLowerCase() : key.toLowerCase();
    typed.current = { text, at: now };
    const from = open ? active : selectedIndex;
    const order = options.map((_, k) => (from + (text.length > 1 ? 0 : 1) + k + options.length) % options.length);
    return order.find((i) => enabled(i) && options[i].text.toLowerCase().startsWith(text)) ?? -1;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const hit = seek(e.key);
        if (hit >= 0) show(hit);
      }
      return;
    }
    const page = 8;
    const moves: Record<string, () => number> = {
      ArrowDown: () => step(active, 1),
      ArrowUp: () => step(active, -1),
      Home: first,
      End: last,
      PageDown: () => Array.from({ length: page }).reduce<number>((i) => step(i, 1), active),
      PageUp: () => Array.from({ length: page }).reduce<number>((i) => step(i, -1), active),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setActive(moves[e.key]());
    } else if (e.key === "Enter" || (e.key === " " && typed.current.at < Date.now() - 1000)) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      // Keep sheets and dialogs underneath open.
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === "Tab") {
      hide(false);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const hit = seek(e.key);
      if (hit >= 0) setActive(hit);
    }
  };

  // While open: close on a press outside, follow the trigger when the page scrolls or resizes.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) hide(false);
    };
    const follow = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      measure();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open]);

  // An uncontrolled select goes back to its default when its form resets, as a native one does
  // (React resets a form after its action succeeds).
  const initial = defaultValue !== undefined ? String(defaultValue) : options.find((o) => !o.disabled)?.value ?? "";
  useEffect(() => {
    const form = trigger.current?.form;
    if (!form || value !== undefined) return;
    const reset = () => setInner(initial);
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [initial, value]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onKeyDown}
        className={`inline-flex min-w-0 cursor-default items-center justify-between gap-1.5 text-left ${className} ${open ? "border-ink" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="flex-none text-muted">
          <path d="M3 4.75 6 7.75 9 4.75" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      {open &&
        place &&
        host &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: "fixed", left: place.left, top: place.top, bottom: place.bottom, minWidth: place.width, maxHeight: place.maxHeight, maxWidth: "calc(100vw - 16px)" }}
            className="z-[60] overflow-y-auto overscroll-contain rounded-lg border border-control bg-surface p-1 text-sm text-ink shadow-[0_8px_28px_rgb(0_0_0/0.16)] outline-none"
          >
            {options.map((o, i) => {
              const isSelected = i === selectedIndex;
              return (
                <div
                  key={`${o.value}-${i}`}
                  id={optionId(i)}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => o.disabled || i === active || setActive(i)}
                  onClick={() => pick(i)}
                  className={`flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-2.5 whitespace-nowrap ${
                    o.disabled ? "text-faint" : i === active ? "bg-active" : ""
                  } ${isSelected ? "font-medium" : ""}`}
                >
                  <span className="min-w-0 flex-1">{o.label}</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={`flex-none text-accent ${isSelected ? "" : "invisible"}`}>
                    <path d="M3 7.25 5.75 10 11 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              );
            })}
          </div>,
          host,
        )}
    </>
  );
}

interface Option {
  value: string;
  label: React.ReactNode;
  text: string;
  disabled: boolean;
}

type OptionProps = { value?: string | number; children?: React.ReactNode; disabled?: boolean };

/** The <option> children, through fragments and arrays, as plain data. */
function collectOptions(children: React.ReactNode): Option[] {
  const out: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<OptionProps & { children?: React.ReactNode }>(child)) return;
    if (child.type === Fragment) {
      out.push(...collectOptions(child.props.children));
      return;
    }
    if (child.type !== "option") return;
    const text = textOf(child.props.children);
    out.push({ value: String(child.props.value ?? text), label: child.props.children, text, disabled: !!child.props.disabled });
  });
  return out;
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

interface Placement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** Below the trigger, or above it when there's more room there; never off the window. */
export function placement(r: { left: number; top: number; bottom: number; width: number }, count: number, view = { width: window.innerWidth, height: window.innerHeight }): Placement {
  const gap = 4;
  const margin = 8;
  const want = Math.min(count * 32 + 10, 320);
  const below = view.height - r.bottom - gap - margin;
  const above = r.top - gap - margin;
  const left = Math.max(margin, Math.min(r.left, view.width - margin - r.width));
  if (below >= want || below >= above) return { left, top: r.bottom + gap, width: r.width, maxHeight: Math.min(want, below) };
  return { left, bottom: view.height - r.top + gap, width: r.width, maxHeight: Math.min(want, above) };
}
