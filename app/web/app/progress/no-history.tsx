"use client";

// Progress with no rides yet: a faded picture of the fitness chart the rider would get, and the
// way to bring past rides in, instead of empty charts.

import { BringRidesButton } from "~/setup/bring-rides";

export default function NoHistory({ title = "Your fitness chart can go back two years" }: { title?: string }) {
  return (
    <div className="relative h-56 overflow-hidden rounded-lg border border-line bg-surface">
      <svg viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full text-accent opacity-50">
        <path d="M0 180 C60 165 90 140 140 145 S230 105 280 110 S380 75 430 90 S540 55 600 60 L600 220 L0 220Z" className="fill-accent-soft" />
        <path d="M0 180 C60 165 90 140 140 145 S230 105 280 110 S380 75 430 90 S540 55 600 60" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6" />
      </svg>
      <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 bg-surface/60 p-4 text-center">
        <p className="font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted">Bring in past rides and you&apos;ll see fitness, fatigue and your power curve from before Lactic.</p>
        <BringRidesButton />
      </div>
    </div>
  );
}
