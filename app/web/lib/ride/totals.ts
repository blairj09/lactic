// The ride so far, for the overlay's right-hand column: averages and stress from the 1 Hz samples.
// Pure, so it tests in Node.

import { rideStress } from "../engine/power";

export interface RideTotals {
  /** Average power over every ride second, coasting included. */
  power: number | null;
  /** Average heart rate over the seconds with a reading. */
  heartRate: number | null;
  /** Average cadence over the seconds you pedaled. */
  cadence: number | null;
  tss: number | null;
}

const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

export function rideTotals(watts: number[], heartRate: number[], cadence: number[], ftp: number): RideTotals {
  const tss = rideStress(watts, ftp);
  return {
    power: mean(watts),
    heartRate: mean(heartRate.filter((h) => h > 0)),
    cadence: mean(cadence.filter((c) => c > 0)),
    tss: tss === null ? null : Math.round(tss),
  };
}
