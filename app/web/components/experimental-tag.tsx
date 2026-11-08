/** Marks a feature that's still experimental (Settings → Experimental features). */
export function ExperimentalTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="Experimental: still being tried out, so it may change. Turn it on or off in Settings → Experimental features."
      className={`inline-flex items-center rounded bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-warning ${className}`}
    >
      Experimental
    </span>
  );
}
