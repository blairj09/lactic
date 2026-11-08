/** Marks a feature that's still experimental (Settings → Experimental features). */
export function ExperimentalTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="Experimental: still being tried out, so it may change. Turn it on or off in Settings → Experimental features."
      className={`inline-flex items-center rounded border border-dashed border-current px-1.5 py-px text-[10px] font-semibold tracking-wide text-warning uppercase ${className}`}
    >
      Experimental
    </span>
  );
}
