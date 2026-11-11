/**
 * The one way hours read in Lactic: "7h 56m", "7h 05m", whole hours "9h", under an hour "24m".
 * Used for sleep, sleep debt and need, stages and time in zones.
 */
export function formatHours(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}
