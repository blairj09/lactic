/** The browser's local calendar day as YYYY-MM-DD. */
export function dayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Milliseconds until just after the next local midnight (a few seconds late, so the server sees the new day too). */
export function msUntilNextDay(now: Date, slackMs = 5_000): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + slackMs;
}

let holds = 0;

/** Holds off new-day refreshes (e.g. during a ride). Returns the release function. */
export function holdNewDayRefresh(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds--;
    if (holds === 0) listeners.forEach((l) => l());
  };
}

export const newDayRefreshHeld = () => holds > 0;

const listeners = new Set<() => void>();

/** Called whenever the last hold is released, so a refresh skipped during a ride can run. */
export function onNewDayHoldsReleased(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
