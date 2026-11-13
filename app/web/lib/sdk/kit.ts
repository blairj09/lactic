// The component kit as data: what a widget asks Lactic to draw. Built-in widgets and plugins both
// return a tree of these nodes, never HTML, so Lactic draws every pixel with its own components,
// in its own theme, on desktop and phone (and the simplest nodes natively in iPhone widgets).
//
// validateKit() is the gate for anything a plugin sends back: unknown node types, oversized trees,
// long strings and odd numbers are refused, so a plugin can't smuggle markup, fake a Lactic
// control or flood the screen (review items S3, S8). Plain data, no browser or Node APIs.

export type Tone = "default" | "good" | "warn" | "bad" | "muted";

/** What a Button may do. Plugin buttons can only open the plugin's own detail view (review S8). */
export type KitAction = { kind: "open-detail" } | { kind: "lactic"; to: "ride" | "plan" | "progress" | "health" | "settings" };

export type KitNode =
  /** A big number with a label, like a head-unit field. */
  | { type: "field"; label: string; value: string; unit?: string; sub?: string; tone?: Tone; lead?: boolean }
  /** A smaller number with a label and a line under it. */
  | { type: "stat"; label: string; value: string; sub?: string; tone?: Tone }
  | { type: "text"; text: string; tone?: Tone; size?: "sm" | "md" | "lg"; weight?: "normal" | "medium" | "semibold" }
  /** A small trend line; values only, scaled to fit. */
  | { type: "sparkline"; values: (number | null)[]; tone?: Tone }
  /** Simple bars, e.g. per day; labels optional. `palette: "zones"` colours bar 1 as zone 1, bar 2 as zone 2 and so on (up to 7). */
  | { type: "bars"; values: (number | null)[]; labels?: string[]; tone?: Tone; palette?: "zones" }
  /** A 0 to 1 bar, e.g. how much of the week is done. */
  | { type: "meter"; value: number; label?: string; tone?: Tone }
  | { type: "stack"; direction?: "row" | "column"; gap?: "sm" | "md"; children: KitNode[] }
  /** A small table of text cells, e.g. one row per climb or interval. Counts as one node. */
  | { type: "table"; columns: string[]; rows: string[][]; align?: ("left" | "right")[] }
  /** A line over a ride (power, heart rate, a plugin's own series) against time or distance, with marked stretches. */
  | { type: "profile"; x: number[]; y: (number | null)[]; xUnit?: "s" | "km"; yUnit?: string; tone?: Tone; marks?: { from: number; to: number; label?: string; tone?: Tone }[] }
  | { type: "button"; label: string; action: KitAction };

export type KitNodeType = KitNode["type"];

export const KIT_LIMITS = {
  /** Nodes in one tree. */
  nodes: 200,
  /** Nesting depth of stacks. */
  depth: 6,
  /** Characters in any one string. */
  text: 280,
  /** Points in a sparkline or bars. */
  points: 400,
  /** Points in a profile. */
  profilePoints: 2000,
  /** Marked stretches on a profile. */
  marks: 40,
  /** Table columns and rows, and characters in one cell. */
  columns: 8,
  rows: 200,
  cell: 60,
} as const;

const TONES: readonly Tone[] = ["default", "good", "warn", "bad", "muted"];
const LACTIC_DESTINATIONS = ["ride", "plan", "progress", "health", "settings"] as const;

export type KitResult = { ok: true; node: KitNode } | { ok: false; error: string };

/**
 * Checks an untrusted tree and returns a clean copy built only from known fields, so extra
 * properties (event handlers, style, html) never reach the renderer. `fromPlugin` also refuses
 * Lactic navigation buttons.
 */
export function validateKit(input: unknown, { fromPlugin = true }: { fromPlugin?: boolean } = {}): KitResult {
  let count = 0;
  const fail = (error: string): never => {
    throw new KitError(error);
  };
  const str = (v: unknown, name: string, optional = false): string | undefined => {
    if (v === undefined && optional) return undefined;
    if (typeof v !== "string") return fail(`${name} must be text`);
    if (v.length > KIT_LIMITS.text) return fail(`${name} is longer than ${KIT_LIMITS.text} characters`);
    return v;
  };
  const cell = (v: unknown, name: string): string => {
    if (typeof v !== "string") return fail(`table ${name}s must be text`);
    if (v.length > KIT_LIMITS.cell) return fail(`a table ${name} is longer than ${KIT_LIMITS.cell} characters`);
    return v;
  };
  const tone = (v: unknown): Tone | undefined => {
    if (v === undefined) return undefined;
    if (!TONES.includes(v as Tone)) return fail(`unknown tone ${String(v)}`);
    return v as Tone;
  };
  const series = (v: unknown, name: string, max: number = KIT_LIMITS.points): (number | null)[] => {
    if (!Array.isArray(v)) return fail(`${name} must be a list`);
    if (v.length > max) return fail(`${name} has more than ${max} points`);
    return v.map((x) => (x === null ? null : typeof x === "number" && Number.isFinite(x) ? x : fail(`${name} must hold numbers`)));
  };
  const pick = <T extends string>(v: unknown, options: readonly T[], name: string): T | undefined => {
    if (v === undefined) return undefined;
    if (!options.includes(v as T)) return fail(`unknown ${name} ${String(v)}`);
    return v as T;
  };
  const strip = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

  const walk = (n: unknown, depth: number): KitNode => {
    if (++count > KIT_LIMITS.nodes) fail(`more than ${KIT_LIMITS.nodes} nodes`);
    if (depth > KIT_LIMITS.depth) fail(`nested deeper than ${KIT_LIMITS.depth}`);
    if (typeof n !== "object" || n === null || Array.isArray(n)) return fail("a node must be an object");
    const o = n as Record<string, unknown>;
    switch (o.type) {
      case "field":
        return strip({ type: "field", label: str(o.label, "label")!, value: str(o.value, "value")!, unit: str(o.unit, "unit", true), sub: str(o.sub, "sub", true), tone: tone(o.tone), lead: o.lead === undefined ? undefined : Boolean(o.lead) });
      case "stat":
        return strip({ type: "stat", label: str(o.label, "label")!, value: str(o.value, "value")!, sub: str(o.sub, "sub", true), tone: tone(o.tone) });
      case "text":
        return strip({ type: "text", text: str(o.text, "text")!, tone: tone(o.tone), size: pick(o.size, ["sm", "md", "lg"] as const, "size"), weight: pick(o.weight, ["normal", "medium", "semibold"] as const, "weight") });
      case "sparkline":
        return strip({ type: "sparkline", values: series(o.values, "values"), tone: tone(o.tone) });
      case "bars": {
        const labels = o.labels === undefined ? undefined : Array.isArray(o.labels) && o.labels.length <= KIT_LIMITS.points ? o.labels.map((l) => str(l, "label")!) : fail("labels must be a short list");
        return strip({ type: "bars", values: series(o.values, "values"), labels, tone: tone(o.tone), palette: pick(o.palette, ["zones"] as const, "palette") });
      }
      case "meter": {
        if (typeof o.value !== "number" || !Number.isFinite(o.value)) return fail("meter value must be a number");
        return strip({ type: "meter", value: Math.min(1, Math.max(0, o.value)), label: str(o.label, "label", true), tone: tone(o.tone) });
      }
      case "stack": {
        if (!Array.isArray(o.children)) return fail("stack children must be a list");
        return strip({ type: "stack", direction: pick(o.direction, ["row", "column"] as const, "direction"), gap: pick(o.gap, ["sm", "md"] as const, "gap"), children: o.children.map((c) => walk(c, depth + 1)) });
      }
      case "table": {
        if (!Array.isArray(o.columns) || o.columns.length === 0 || o.columns.length > KIT_LIMITS.columns) return fail(`table needs 1 to ${KIT_LIMITS.columns} columns`);
        const columns = o.columns.map((c) => cell(c, "column"));
        if (!Array.isArray(o.rows) || o.rows.length > KIT_LIMITS.rows) return fail(`table can have at most ${KIT_LIMITS.rows} rows`);
        const rows = o.rows.map((r) => (Array.isArray(r) && r.length === columns.length ? r.map((c) => cell(c, "cell")) : fail("each table row needs one cell per column")));
        const align = o.align === undefined ? undefined : Array.isArray(o.align) && o.align.length === columns.length ? o.align.map((a) => pick(a, ["left", "right"] as const, "align")!) : fail("align needs one entry per column");
        return strip({ type: "table", columns, rows, align });
      }
      case "profile": {
        const x = series(o.x, "x", KIT_LIMITS.profilePoints);
        const y = series(o.y, "y", KIT_LIMITS.profilePoints);
        if (x.length !== y.length || x.some((v) => v === null)) return fail("profile needs one x number per y value");
        const marks =
          o.marks === undefined
            ? undefined
            : Array.isArray(o.marks) && o.marks.length <= KIT_LIMITS.marks
              ? o.marks.map((m) => {
                  const mm = (m ?? {}) as Record<string, unknown>;
                  if (typeof mm.from !== "number" || typeof mm.to !== "number" || !Number.isFinite(mm.from) || !Number.isFinite(mm.to)) return fail("profile marks need from and to numbers");
                  return strip({ from: mm.from, to: mm.to, label: str(mm.label, "mark label", true), tone: tone(mm.tone) });
                })
              : fail(`profile can have at most ${KIT_LIMITS.marks} marks`);
        return strip({ type: "profile", x: x as number[], y, xUnit: pick(o.xUnit, ["s", "km"] as const, "x unit"), yUnit: str(o.yUnit, "y unit", true), tone: tone(o.tone), marks });
      }
      case "button": {
        const a = o.action as Record<string, unknown> | undefined;
        let action: KitAction;
        if (a?.kind === "open-detail") action = { kind: "open-detail" };
        else if (a?.kind === "lactic" && !fromPlugin) action = { kind: "lactic", to: pick(a.to, LACTIC_DESTINATIONS, "destination") ?? fail("lactic button needs a destination") };
        else return fail("buttons can only open the widget's own detail view");
        return { type: "button", label: str(o.label, "label")!, action };
      }
      default:
        return fail(`unknown node type ${String(o.type)}`);
    }
  };

  try {
    return { ok: true, node: walk(input, 0) };
  } catch (e) {
    if (e instanceof KitError) return { ok: false, error: e.message };
    throw e;
  }
}

class KitError extends Error {}
