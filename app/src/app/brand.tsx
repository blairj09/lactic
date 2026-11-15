import { isBeta, isModular, isPreview } from "./beta";

// Lactic's mark: an L drawn as a stepped ramp test, then the endurance tail (logo concept C).

export const MARK_PATH = "M2 21V15H4.5V10.5H7V6.5H9.5V3H12V15H22V21Z";

export function Mark({ size = 18, color = "var(--accent)" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="2 2 20 20" aria-hidden className="shrink-0">
      <path d={MARK_PATH} fill={color} />
    </svg>
  );
}

/** The mark on its blue tile, as on the app icon. */
export function MarkTile({ size = 56 }: { size?: number }) {
  return (
    <span className="inline-grid shrink-0 place-items-center bg-accent" style={{ width: size, height: size, borderRadius: size * 0.225 }}>
      <svg width={size * 0.58} height={size * 0.58} viewBox="2 2 20 20" aria-hidden>
        <path d={MARK_PATH} fill="#fff" />
      </svg>
    </span>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight text-ink" style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.2)} />
      Lactic
      {isModular ? <ModularTag /> : isPreview ? <PreviewTag /> : isBeta && <BetaTag />}
    </span>
  );
}

/** Shown beside the name while the version is below 1.0.0. */
export function BetaTag() {
  return (
    <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-accent" title="Lactic is in beta until version 1.0">
      Beta
    </span>
  );
}

/** Shown beside the name in a Lactic Preview build (a testing build with its own data). */
export function PreviewTag() {
  return (
    <span className="rounded bg-[#e8761a]/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#c2610f]" title="A testing build of Lactic, with its own data, separate from the released app">
      Preview
    </span>
  );
}

/** Shown beside the name in a Lactic Modular build (the modular-ui branch, with its own data). */
export function ModularTag() {
  return (
    <span className="rounded bg-[#7a3fd1]/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#7a3fd1]" title="A testing build of the customizable Lactic, with its own data, separate from Lactic and Lactic Preview">
      Modular
    </span>
  );
}
