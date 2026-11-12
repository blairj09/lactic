// A widget: something a layout can place. Lactic's own cards and ride fields are widgets, and so
// are a plugin's (the plugin runtime turns its manifest into these). Plain data, no browser APIs.

/** Where a widget can go. */
export type Surface =
  /** A card in Today's column. */
  | "today"
  /** A field on a ride page (and the overlay over Zwift, which uses the same fields). */
  | "ride"
  /** A field in the iPhone's home and lock screen widgets (drawn natively from a snapshot). */
  | "phone-widget";

/**
 * Card sizes in Today's ordered column (review U1): Large takes the full width; two Medium cards
 * sit side by side on a computer; Small cards sit three across. On a phone, Large and Medium take
 * the full width and Small cards pair up.
 */
export type CardSize = "small" | "medium" | "large";

export type WidgetSource = { kind: "lactic" } | { kind: "plugin"; pluginId: string; pluginName: string };

export interface WidgetManifest {
  /** "lactic.recovery", "plugin.wprime-tools.chart". Stable once shipped: layouts refer to it. */
  id: string;
  name: string;
  /** One line for the library ("Last night's recovery and what drove it"). */
  description: string;
  source: WidgetSource;
  surfaces: Surface[];
  /** Today sizes it can be shown at; the first is its default. Ignored on other surfaces. */
  sizes: CardSize[];
  /** Metric ids it reads (metrics.ts). For a plugin these are exactly what it was allowed. */
  reads: string[];
  /**
   * Built-in cards that decide for themselves whether there's anything to show today (the rest
   * day card, the weigh-in nudge). A layout says where they go, not whether they appear.
   */
  conditional?: boolean;
  /** Can't be removed from Today, only moved (none yet; kept for e.g. a pinned race notice). */
  required?: boolean;
}

export function isLactic(w: Pick<WidgetManifest, "source">): boolean {
  return w.source.kind === "lactic";
}
