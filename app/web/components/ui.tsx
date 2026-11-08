/**
 * Shared building blocks, styled only with the tokens in globals.css. No hooks here, so server
 * pages can use them; Segmented takes handlers, so render it from a client component.
 */

import Link from "next/link";

type Children = { children?: React.ReactNode };
const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/** The page column under the top bar. */
export function Page({ children, className, width = "wide" }: Children & { className?: string; width?: "narrow" | "medium" | "wide" }) {
  const max = { narrow: "max-w-3xl", medium: "max-w-5xl", wide: "max-w-6xl" }[width];
  return <main className={cx("mx-auto w-full space-y-6 px-4 pt-5 pb-20 sm:space-y-8 sm:px-6 sm:pt-8", max, className)}>{children}</main>;
}

/** The screen's h1, one grey line about the data (not the interface), and its real actions. */
export function PageHeader({ title, line, actions }: { title: React.ReactNode; line?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {line && <p className="max-w-3xl text-[15px] text-muted">{line}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A surface with an optional title row; `meta` sits at the right of the title in grey (a period, a link). */
export function Panel({
  title,
  meta,
  children,
  className,
  pad = true,
}: Children & { title?: React.ReactNode; meta?: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", pad && "p-4 sm:p-5", className)}>
      {(title || meta) && (
        <div className={cx("mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", !pad && "px-4 pt-4 sm:px-5 sm:pt-5")}>
          {title && <h2 className="text-base font-medium">{title}</h2>}
          {meta && <div className="text-sm text-muted">{meta}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A section heading outside a panel, with a right-aligned meta slot. */
export function SectionTitle({ children, meta }: Children & { meta?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-base font-medium">{children}</h2>
      {meta && <div className="text-sm text-muted">{meta}</div>}
    </div>
  );
}

/** Peer figures in one container split by 1px lines. `cols` is the item count at desktop, `phone` the columns on a phone. */
export function StatStrip({ children, cols = 4, phone = 1 }: Children & { cols?: 2 | 3 | 4 | 5 | 6; phone?: 1 | 2 | 3 }) {
  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5", 6: "sm:grid-cols-3 lg:grid-cols-6" }[cols];
  const base = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[phone];
  return <div className={cx("grid gap-px overflow-hidden rounded-lg border border-line bg-line", base, grid)}>{children}</div>;
}

/** A label over a figure. Units are a smaller grey suffix; `sub` is one grey line under it. */
export function Stat({
  label,
  value,
  unit,
  sub,
  lead,
  className,
  href,
  source,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  /** Where the number came from (components/provenance.tsx), on its own line under it. */
  source?: React.ReactNode;
  /** The screen's answer figure: larger than its siblings. */
  lead?: boolean;
  className?: string;
  /** Makes the whole tile a link to a closer look, with a quiet arrow by the label. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2 text-sm text-muted">
        <span className="min-w-0">{label}</span>
        {href && <Chevron />}
      </div>
      <div className={cx("num font-medium tracking-tight", lead ? "text-[32px] leading-10" : "text-2xl")}>
        {value ?? <Dash />}
        {unit && <span className="ml-1 text-sm font-normal tracking-normal text-muted">{unit}</span>}
      </div>
      {sub && <div className="text-sm text-muted">{sub}</div>}
      {source && <div>{source}</div>}
    </>
  );
  const base = cx("min-w-0 space-y-1 bg-surface p-4 sm:p-5", className);
  if (!href) return <div className={base}>{body}</div>;
  return (
    <Link href={href} scroll={false} className={cx(base, "group block transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink")}>
      {body}
    </Link>
  );
}

/** The arrow on a tile that opens a closer look. */
export function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="mt-0.5 flex-none text-faint transition-colors group-hover:text-ink">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A missing value: a quiet dash, never a zero. */
export const Dash = () => <span className="text-faint">–</span>;

export const button = {
  primary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50",
  secondary:
    "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-control bg-surface px-3.5 text-sm text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50",
  ghost: "inline-flex h-9 items-center gap-1 text-sm text-muted underline-offset-4 transition-colors hover:text-ink hover:underline disabled:opacity-50",
  /** A small primary for rows and tight spots. */
  smallPrimary:
    "inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-on-primary transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50",
  /** A small secondary for rows and tight spots. */
  small:
    "inline-flex h-8 items-center justify-center rounded-md border border-control bg-surface px-3 text-sm text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50",
};

/** Inputs and selects: one height, a 1px control border, the surface fill. */
export const input =
  "h-9 rounded-md border border-control bg-surface px-3 text-sm text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ink disabled:opacity-50";

/** A native file picker whose button matches the secondary button. */
export const fileInput =
  "max-w-full text-sm text-muted file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-control file:bg-surface file:px-3.5 file:text-sm file:text-ink hover:file:bg-raised disabled:opacity-50";

/** Label above the control, hint under it. */
export function Field({ label, hint, children, className }: Children & { label: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block space-y-2", className)}>
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-sm text-muted">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "positive" | "negative" | "warning";
const PILL: Record<Tone, string> = {
  neutral: "bg-raised text-ink",
  positive: "bg-pill-positive text-positive",
  negative: "bg-pill-negative text-negative",
  warning: "bg-pill-warning text-warning",
};

/** A small status tag beside a value, never above a heading. */
export function Pill({ tone = "neutral", children }: Children & { tone?: Tone }) {
  return <span className={cx("inline-flex h-6 flex-none items-center rounded px-2 text-xs font-medium whitespace-nowrap", PILL[tone])}>{children}</span>;
}

/** A sentence that needs attention, inside the block it's about. */
export function Notice({ tone = "warning", children }: Children & { tone?: "warning" | "negative" }) {
  return <p className={cx("rounded-md px-3 py-2 text-sm", tone === "warning" ? "bg-pill-warning text-warning" : "bg-pill-negative text-negative")}>{children}</p>;
}

/** Form feedback after a save: grey when fine, red when not. */
export function Result({ ok, children }: Children & { ok: boolean }) {
  return (
    <p className={cx("text-sm", ok ? "text-muted" : "text-negative")} role={ok ? "status" : "alert"}>
      {children}
    </p>
  );
}

/** A segmented choice, as wide as its options (or as its container, with `fill`). `wrap` puts them in two columns on a phone. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
  fill,
  wrap,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  fill?: boolean;
  wrap?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx(
        "grid w-full auto-cols-fr gap-0.5 rounded-md bg-raised p-0.5",
        wrap ? "grid-cols-2 sm:grid-flow-col sm:grid-cols-none" : "grid-flow-col",
        !fill && "sm:inline-grid sm:w-auto",
      )}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 rounded text-sm whitespace-nowrap text-muted transition-colors hover:text-ink disabled:opacity-50 aria-checked:bg-surface aria-checked:font-medium aria-checked:text-ink aria-checked:shadow-[0_0_0_1px_var(--line)]",
            fill ? "px-1" : "px-2 sm:px-3",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
