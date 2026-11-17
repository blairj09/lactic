"use client";

/** An on/off switch with its label and an optional one-line hint beside it. */
export function SwitchRow({ label, hint, on, onChange, disabled }: { label: string; hint?: React.ReactNode; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="mt-0.5 flex-none disabled:opacity-50">
        <span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-active"}`}>
          <span className={`absolute top-0.5 size-4 rounded-full transition-all ${on ? "left-[1.125rem] bg-on-primary" : "left-0.5 bg-muted"}`} />
        </span>
      </button>
      <div className="text-sm">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-muted">{hint}</span>}
      </div>
    </div>
  );
}
