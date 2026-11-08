"use client";

/** A heart that adds a workout to favorites or takes it off. Shows its label beside it when `label` is set. */
export default function FavoriteButton({
  on,
  name,
  onToggle,
  label,
  disabled,
}: {
  on: boolean;
  /** The workout's name, for screen readers. */
  name: string;
  onToggle: () => void;
  /** Visible text, e.g. "Favorite this workout". */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label ? undefined : on ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
      title={on ? "Remove from favorites" : "Add to favorites"}
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-sm transition-colors hover:text-ink disabled:opacity-50 ${label ? "border border-control bg-surface px-3 hover:bg-raised" : "w-8"} ${
        on ? "text-accent" : "text-muted"
      }`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.4 4c2 0 3.5 1.1 4.6 2.7C13.1 5.1 14.6 4 16.6 4c3.5 0 5.8 3.6 4.6 7.1-1.7 4.8-9.2 9.4-9.2 9.4z" />
      </svg>
      {label && <span className="text-ink">{on ? "In favorites" : label}</span>}
    </button>
  );
}
