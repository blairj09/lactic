// Speedometer: how fast your power would carry you on a flat road, on a dial.
//
// On a trainer nothing moves, so this works the speed out from physics. Riding on the flat, your
// power goes into two forces (Martin et al., 1998, "Validation of a mathematical model for road
// cycling power"):
//   rolling resistance  Crr × m × g          (tyres on tarmac)
//   air drag            ½ × ρ × CdA × v²     (pushing air out of the way)
// Power is force times speed, less what the drivetrain loses:
//   P × η = (Crr·m·g + ½·ρ·CdA·v²) × v
// which has one positive answer for v. We find it with a few steps of Newton's method.
//
// The constants are for a rider on the hoods of a road bike, on good tarmac, at sea level, no wind.
// Your weight comes from Lactic's profile (75 kg if you haven't set one), plus 9 kg of bike.
//
// It shows a `gauge`: we send the speed, the range and three bands, and Lactic draws the dial.
import { definePlugin } from "@lactic/sdk";

const CRR = 0.005; // rolling resistance, road tyres on good tarmac
const CDA = 0.32; // drag area in m², on the hoods
const RHO = 1.225; // air density in kg/m³, sea level at 15 °C
const G = 9.81;
const DRIVETRAIN = 0.976; // share of your power that reaches the wheel
const BIKE_KG = 9;

/** Speed in m/s for `watts` on a flat road, for a total mass of `kg`. */
export function flatSpeed(watts: number, kg: number): number {
  if (watts <= 0) return 0;
  const p = watts * DRIVETRAIN;
  const roll = CRR * kg * G;
  const air = 0.5 * RHO * CDA;
  let v = 10;
  for (let i = 0; i < 30; i++) {
    const f = roll * v + air * v * v * v - p; // power needed at v, less what you have
    const df = roll + 3 * air * v * v;
    const next = v - f / df;
    if (Math.abs(next - v) < 1e-6) return next;
    v = Math.max(0.1, next);
  }
  return v;
}

definePlugin({
  speed(input) {
    const watts = input.metrics["power.3s"] ?? input.metrics.power;
    const weight = input.metrics["profile.weight"] ?? 75;
    const kmh = watts == null ? 0 : flatSpeed(watts, weight + BIKE_KG) * 3.6;
    return {
      tree: {
        type: "gauge",
        value: kmh,
        min: 0,
        max: 60,
        unit: "km/h",
        decimals: 1,
        zones: [{ to: 25 }, { to: 40 }, { to: 60 }],
        ticks: 10,
        needle: true,
      },
      metrics: { speed: Math.round(kmh * 10) / 10 },
    };
  },
});
