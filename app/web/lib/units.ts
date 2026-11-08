// Metric or imperial, for showing and typing weight, height, distance, elevation, speed and
// temperature. The engine and the database always work in metric (kg, cm, m, °C); this only
// changes what the rider sees. Kept per device in localStorage, like the theme, and defaults to
// what's usual where the computer is set (imperial in the US, Liberia and Myanmar).
//
// Watts per kilo and VO2 max (ml/kg/min) stay per kilo either way: that's how cyclists everywhere
// compare them.

export type UnitSystem = "metric" | "imperial";

export const UNITS_KEY = "lactic:units";
/** The first-run setup's own key before Units was a setting. Only "imperial" there counts as a choice. */
const SETUP_KEY = "lactic.units";
export const UNITS_EVENT = "lactic:units";

export const LB_PER_KG = 2.20462;
export const CM_PER_IN = 2.54;
export const M_PER_MILE = 1609.344;
export const FT_PER_M = 3.28084;

const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

export function parseUnits(value: unknown): UnitSystem | null {
  return value === "metric" || value === "imperial" ? value : null;
}

/** Imperial when the locale's region is the US, Liberia or Myanmar; metric everywhere else. */
export function defaultUnits(locale: string | undefined): UnitSystem {
  if (!locale) return "metric";
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).maximize().region;
  } catch {
    region = locale.split(/[-_]/)[1];
  }
  return region && IMPERIAL_REGIONS.has(region.toUpperCase()) ? "imperial" : "metric";
}

function deviceLocale(): string | undefined {
  try {
    return globalThis.navigator?.language ?? Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

/** The rider's choice, or the locale's usual system when they haven't picked. */
export function readUnits(): UnitSystem {
  try {
    const store = globalThis.localStorage;
    const saved = parseUnits(store?.getItem(UNITS_KEY));
    if (saved) return saved;
    if (store?.getItem(SETUP_KEY) === "imperial") return "imperial";
  } catch {
    // No storage: fall back to the locale.
  }
  return defaultUnits(deviceLocale());
}

export function setUnits(units: UnitSystem) {
  try {
    globalThis.localStorage?.setItem(UNITS_KEY, units);
  } catch {
    // Private mode: still applies until the page reloads.
  }
  globalThis.dispatchEvent?.(new CustomEvent(UNITS_EVENT, { detail: units }));
}

/** Weight in the rider's units: 72 kg, or 158.7 lb. */
export const weightIn = (kg: number, units: UnitSystem) => (units === "imperial" ? kg * LB_PER_KG : kg);
export const weightToKg = (value: number, units: UnitSystem) => (units === "imperial" ? value / LB_PER_KG : value);
export const weightUnit = (units: UnitSystem) => (units === "imperial" ? "lb" : "kg");
export const formatWeight = (kg: number, units: UnitSystem, decimals = 1) => `${weightIn(kg, units).toFixed(decimals)} ${weightUnit(units)}`;

/** Height in the rider's units: cm, or inches. */
export const heightIn = (cm: number, units: UnitSystem) => (units === "imperial" ? cm / CM_PER_IN : cm);
export const heightToCm = (value: number, units: UnitSystem) => (units === "imperial" ? value * CM_PER_IN : value);
export const heightUnit = (units: UnitSystem) => (units === "imperial" ? "in" : "cm");

/** Distance: km, or miles. */
export const distanceIn = (meters: number, units: UnitSystem) => (units === "imperial" ? meters / M_PER_MILE : meters / 1000);
export const distanceUnit = (units: UnitSystem) => (units === "imperial" ? "mi" : "km");
export const formatDistance = (meters: number, units: UnitSystem, decimals = 1) => `${distanceIn(meters, units).toFixed(decimals)} ${distanceUnit(units)}`;

/** Elevation: m, or feet. */
export const elevationIn = (meters: number, units: UnitSystem) => (units === "imperial" ? meters * FT_PER_M : meters);
export const elevationUnit = (units: UnitSystem) => (units === "imperial" ? "ft" : "m");
export const formatElevation = (meters: number, units: UnitSystem) => `${Math.round(elevationIn(meters, units))} ${elevationUnit(units)}`;

/** Speed: km/h, or mph. */
export const speedIn = (metersPerSecond: number, units: UnitSystem) => (units === "imperial" ? (metersPerSecond * 3600) / M_PER_MILE : metersPerSecond * 3.6);
export const speedUnit = (units: UnitSystem) => (units === "imperial" ? "mph" : "km/h");

/** A temperature change (not a reading): 0.5 °C is 0.9 °F. */
export const tempDeltaIn = (celsius: number, units: UnitSystem) => (units === "imperial" ? celsius * 1.8 : celsius);
export const temperatureUnit = (units: UnitSystem) => (units === "imperial" ? "°F" : "°C");
