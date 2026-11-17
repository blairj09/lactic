// Built-in blocks a plugin can ask Lactic to draw: a gauge, a progress ring, a zone bar, target vs
// actual, a short list, a status word, a countdown and a left/right balance. The plugin describes what
// it means (a value, its range, what's good); Lactic draws it in its own colours and fits it to each
// place it shows up (phone field, big field, wide desktop field, the overlay strip, a ride's page).
//
// Also here: numbers a plugin sends as numbers, formatted by Lactic (decimals, durations, percent and
// the rider's units). Plain data, no browser or Node APIs.
import type { Tone } from "./kit";

/** A step on Lactic's 7-step zone ramp, the colours of power and heart rate zones. */
export type Zone = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ZONES: readonly Zone[] = [1, 2, 3, 4, 5, 6, 7];

/** How Lactic writes a number a plugin sends as a number. */
export type NumberFormat = "number" | "duration" | "percent";

/** A band on a gauge, up to `to`. Coloured by `tone` or `zone`, else by Lactic's zone ramp. */
export interface GaugeBand {
  to: number;
  tone?: Tone;
  zone?: Zone;
}

export type StatusIcon = "check" | "alert" | "up" | "down" | "pause" | "dot" | "half";
export const STATUS_ICONS: readonly StatusIcon[] = ["check", "alert", "up", "down", "pause", "dot", "half"];

export type BlockNode =
  /** A dial: a value between `min` and `max`, with optional coloured bands, tick labels and needle. */
  | { type: "gauge"; value: number; min: number; max: number; label?: string; unit?: string; decimals?: number; format?: NumberFormat; zones?: GaugeBand[]; ticks?: number; needle?: boolean; shape?: "dial" | "half"; target?: number; tone?: Tone; zone?: Zone }
  /** How far through something, 0 to 1, with optional words in the middle. */
  | { type: "ring"; value: number; label?: string; text?: string; tone?: Tone; zone?: Zone }
  /** Where a value sits among bands: `bands` are the edges, low to high (2 to 8 of them, so 1 to 7 bands). */
  | { type: "zonebar"; value: number; bands: number[]; label?: string; names?: string[]; tones?: Tone[] }
  /** A value against a target, good while it's `within` the target. */
  | { type: "target"; value: number; target: number; within?: number; label?: string; unit?: string; decimals?: number; format?: NumberFormat }
  /** A few labelled rows, each with its own tone. */
  | { type: "list"; label?: string; rows: { label: string; value: string; tone?: Tone }[] }
  /** A word for a state, not a number: "Too hot", "Fuel now". */
  | { type: "status"; text: string; tone?: Tone; icon?: StatusIcon; sub?: string; label?: string }
  /** Time to (`until`) or since (`since`) a moment, seconds since 1970. Lactic ticks it every second. */
  | { type: "countdown"; until?: number; since?: number; sub?: string; label?: string; tone?: Tone }
  /** Two sides of one thing, e.g. left/right power, centred at 50/50. */
  | { type: "balance"; left: number; right: number; label?: string };

export type BlockType = BlockNode["type"];
export const BLOCK_TYPES: readonly BlockType[] = ["gauge", "ring", "zonebar", "target", "list", "status", "countdown", "balance"];
export const isBlockType = (t: unknown): t is BlockType => BLOCK_TYPES.includes(t as BlockType);

export const BLOCK_LIMITS = { bands: 7, rows: 8, ticks: 13, decimals: 3 } as const;

/** What validateKit lends a block to check itself with. */
export interface Checks {
  fail: (error: string) => never;
  str: (v: unknown, name: string, optional?: boolean) => string | undefined;
  tone: (v: unknown) => Tone | undefined;
  pick: <T extends string>(v: unknown, options: readonly T[], name: string) => T | undefined;
  strip: <T extends object>(o: T) => T;
}

const finite = (c: Checks, v: unknown, name: string): number => (typeof v === "number" && Number.isFinite(v) ? v : c.fail(`${name} must be a number`));
const optFinite = (c: Checks, v: unknown, name: string): number | undefined => (v === undefined ? undefined : finite(c, v, name));

export function checkZone(c: Checks, v: unknown): Zone | undefined {
  if (v === undefined) return undefined;
  return ZONES.includes(v as Zone) ? (v as Zone) : c.fail("zone must be 1 to 7");
}

export function checkDecimals(c: Checks, v: unknown): number | undefined {
  if (v === undefined) return undefined;
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= BLOCK_LIMITS.decimals ? (v as number) : c.fail(`decimals must be 0 to ${BLOCK_LIMITS.decimals}`);
}

export const checkFormat = (c: Checks, v: unknown) => c.pick(v, ["number", "duration", "percent"] as const, "format");

const list = (c: Checks, v: unknown, name: string, max: number): unknown[] => (Array.isArray(v) && v.length <= max ? v : c.fail(`${name} must be a list of at most ${max}`));
const obj = (c: Checks, v: unknown, name: string) => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : c.fail(`each ${name} must be an object`));

/** Checks one block node from a plugin and returns a clean copy, or fails through `c.fail`. */
export function checkBlock(o: Record<string, unknown>, c: Checks): BlockNode {
  const { str, tone, strip } = c;
  switch (o.type as BlockType) {
    case "gauge": {
      const min = finite(c, o.min, "gauge min");
      const max = finite(c, o.max, "gauge max");
      if (!(max > min)) c.fail("gauge max must be above min");
      const zones =
        o.zones === undefined
          ? undefined
          : list(c, o.zones, "gauge zones", BLOCK_LIMITS.bands).map((z) => {
              const b = obj(c, z, "gauge zone");
              return strip({ to: finite(c, b.to, "zone to"), tone: tone(b.tone), zone: checkZone(c, b.zone) });
            });
      const ticks = optFinite(c, o.ticks, "ticks");
      if (ticks !== undefined && (ticks <= 0 || (max - min) / ticks > BLOCK_LIMITS.ticks - 1)) c.fail(`ticks must split the range into at most ${BLOCK_LIMITS.ticks - 1} steps`);
      return strip({
        type: "gauge",
        value: finite(c, o.value, "gauge value"),
        min,
        max,
        label: str(o.label, "label", true),
        unit: str(o.unit, "unit", true),
        decimals: checkDecimals(c, o.decimals),
        format: checkFormat(c, o.format),
        zones,
        ticks,
        needle: o.needle === undefined ? undefined : Boolean(o.needle),
        shape: c.pick(o.shape, ["dial", "half"] as const, "shape"),
        target: optFinite(c, o.target, "gauge target"),
        tone: tone(o.tone),
        zone: checkZone(c, o.zone),
      });
    }
    case "ring":
      return strip({ type: "ring", value: Math.min(1, Math.max(0, finite(c, o.value, "ring value"))), label: str(o.label, "label", true), text: str(o.text, "text", true), tone: tone(o.tone), zone: checkZone(c, o.zone) });
    case "zonebar": {
      const bands = list(c, o.bands, "bands", BLOCK_LIMITS.bands + 1).map((b) => finite(c, b, "band edge"));
      if (bands.length < 2) c.fail("bands needs at least 2 edges");
      if (bands.some((b, i) => i > 0 && b <= bands[i - 1])) c.fail("band edges must go up");
      const n = bands.length - 1;
      const names = o.names === undefined ? undefined : list(c, o.names, "names", n).map((x) => str(x, "band name")!);
      const tones = o.tones === undefined ? undefined : list(c, o.tones, "tones", n).map((t) => tone(t) ?? "default");
      return strip({ type: "zonebar", value: finite(c, o.value, "zonebar value"), bands, label: str(o.label, "label", true), names, tones });
    }
    case "target": {
      const within = optFinite(c, o.within, "within");
      if (within !== undefined && within < 0) c.fail("within can't be below 0");
      return strip({ type: "target", value: finite(c, o.value, "value"), target: finite(c, o.target, "target"), within, label: str(o.label, "label", true), unit: str(o.unit, "unit", true), decimals: checkDecimals(c, o.decimals), format: checkFormat(c, o.format) });
    }
    case "list": {
      const rows = list(c, o.rows, "rows", BLOCK_LIMITS.rows).map((r) => {
        const x = obj(c, r, "row");
        return strip({ label: str(x.label, "row label")!, value: str(x.value, "row value")!, tone: tone(x.tone) });
      });
      return strip({ type: "list", label: str(o.label, "label", true), rows });
    }
    case "status":
      return strip({ type: "status", text: str(o.text, "text")!, tone: tone(o.tone), icon: c.pick(o.icon, STATUS_ICONS, "icon"), sub: str(o.sub, "sub", true), label: str(o.label, "label", true) });
    case "countdown": {
      const until = optFinite(c, o.until, "until");
      const since = optFinite(c, o.since, "since");
      if ((until === undefined) === (since === undefined)) c.fail("countdown needs one of until or since");
      return strip({ type: "countdown", until, since, sub: str(o.sub, "sub", true), label: str(o.label, "label", true), tone: tone(o.tone) });
    }
    case "balance": {
      const left = finite(c, o.left, "left");
      const right = finite(c, o.right, "right");
      if (left < 0 || right < 0 || left + right <= 0) c.fail("balance needs two numbers 0 or more, not both 0");
      return strip({ type: "balance", left, right, label: str(o.label, "label", true) });
    }
  }
  return c.fail(`unknown node type ${String(o.type)}`);
}

// ---- Numbers ----

export type UnitSystem = "metric" | "imperial";

/** Units Lactic converts for an imperial rider. A plugin always sends metric. */
const IMPERIAL: Record<string, { unit: string; scale: (v: number) => number }> = {
  "km/h": { unit: "mph", scale: (v) => v / 1.609344 },
  km: { unit: "mi", scale: (v) => v / 1.609344 },
  m: { unit: "ft", scale: (v) => v * 3.28084 },
  kg: { unit: "lb", scale: (v) => v * 2.2046226 },
  "°C": { unit: "°F", scale: (v) => v * 1.8 + 32 },
};

/** The rider's units for a metric unit and value: 34.2 km/h is 21.3 mph. Ranges convert the same way. */
export function inUnits(value: number, unit: string | undefined, units: UnitSystem): { value: number; unit: string } {
  const to = units === "imperial" && unit ? IMPERIAL[unit] : undefined;
  return to ? { value: to.scale(value), unit: to.unit } : { value, unit: unit ?? "" };
}

/** A clock: 4:18, 1:02:03. Negative counts as 0. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * A number as Lactic writes it: `duration` as a clock, `percent` from 0 to 1 as "72%", otherwise
 * with `decimals` (0 when left out) and thousands grouped. "-0" never shows.
 */
export function formatNumber(value: number, { decimals, format }: { decimals?: number; format?: NumberFormat } = {}): string {
  if (format === "duration") return clock(value);
  if (format === "percent") return `${formatNumber(value * 100, { decimals })}%`;
  const d = decimals ?? 0;
  const fixed = Number(value.toFixed(d));
  return (Object.is(fixed, -0) ? 0 : fixed).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** A plugin's number with its unit in the rider's units, ready to show. */
export function shownNumber(value: number, unit: string | undefined, opts: { decimals?: number; format?: NumberFormat }, units: UnitSystem): { text: string; unit: string } {
  const v = opts.format ? { value, unit: unit ?? "" } : inUnits(value, unit, units);
  return { text: formatNumber(v.value, opts), unit: opts.format === "percent" ? "" : v.unit };
}

// ---- What a block works out, for drawing ----

/** Which band (0-based) a value falls in, given the band edges low to high. Below the first edge is band 0. */
export function bandOf(value: number, edges: readonly number[]): number {
  const n = edges.length - 1;
  for (let i = 0; i < n; i++) if (value < edges[i + 1]) return i;
  return n - 1;
}

/** Where a value sits along a zone bar, 0 to 1, each band the same width. */
export function zonebarPosition(value: number, edges: readonly number[]): number {
  const n = edges.length - 1;
  const i = bandOf(value, edges);
  const within = (value - edges[i]) / (edges[i + 1] - edges[i]);
  return Math.min(1, Math.max(0, (i + Math.min(1, Math.max(0, within))) / n));
}

/** The zone ramp step for band `i` of `n` when the plugin doesn't colour it: spread over steps 2 to 7. */
export const rampZone = (i: number, n: number): Zone => (n <= 1 ? 4 : (Math.round(2 + (i * 5) / (n - 1)) as Zone));

/** A target block's verdict: how far off, in words, and whether that's good. */
export function targetVerdict(value: number, target: number, within: number | undefined, fmt: (n: number) => string): { words: string; good: boolean } {
  const tol = within ?? Math.abs(target) * 0.02;
  const off = value - target;
  if (Math.abs(off) <= tol) return { words: "On target", good: true };
  return { words: `${fmt(Math.abs(off))} ${off < 0 ? "under" : "over"}`, good: false };
}

/** Left's share of a balance, in whole percent: 48 for 48/52. */
export const balanceLeft = (left: number, right: number) => Math.round((left / (left + right)) * 100);

/** One line for a block, where there's room for only a few characters (narrow phone columns). */
export function blockText(b: BlockNode, units: UnitSystem, now: number): string {
  switch (b.type) {
    case "gauge":
      return shownNumber(b.value, b.unit, b, units).text;
    case "ring":
      return b.text ?? formatNumber(b.value, { format: "percent" });
    case "zonebar":
      return b.names?.[bandOf(b.value, b.bands)] ?? `Z${bandOf(b.value, b.bands) + 1}`;
    case "target":
      return shownNumber(b.value, b.unit, b, units).text;
    case "list":
      return b.rows.slice(0, 3).map((r) => r.value).join(" · ");
    case "status":
      return b.text;
    case "countdown":
      return clock(b.until !== undefined ? b.until - now : now - (b.since ?? now));
    case "balance": {
      const l = balanceLeft(b.left, b.right);
      return `${l}/${100 - l}`;
    }
  }
}

/** Ride field limits for blocks: read from the saddle, so short. */
export const RIDE_BLOCK_LIMITS = { rows: 5, rowLabel: 16, rowValue: 12, status: 20, sub: 40, ringText: 6, bandName: 12 } as const;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A block cut down for a ride field: rows and words trimmed to fit. Null when it can't fit at all. */
export function rideBlock(b: BlockNode): BlockNode | null {
  const L = RIDE_BLOCK_LIMITS;
  switch (b.type) {
    case "list":
      return b.rows.length ? { ...b, rows: b.rows.slice(0, L.rows).map((r) => ({ ...r, label: cut(r.label, L.rowLabel), value: cut(r.value, L.rowValue) })) } : null;
    case "status":
      return { ...b, text: cut(b.text, L.status), ...(b.sub ? { sub: cut(b.sub, L.sub) } : {}) };
    case "countdown":
      return b.sub ? { ...b, sub: cut(b.sub, L.sub) } : b;
    case "ring":
      return b.text ? { ...b, text: cut(b.text, L.ringText) } : b;
    case "zonebar":
      return b.names ? { ...b, names: b.names.map((n) => cut(n, L.bandName)) } : b;
    default:
      return b;
  }
}
