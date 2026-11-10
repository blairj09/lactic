// Finding a race instead of typing it in: reading BikeReg's public event search (free, no key; US
// events), mapping its event types to Lactic's kinds, spotting course links on an event's page, and
// reading a Ride with GPS route. Fetching is the caller's. No browser or Node APIs.

import type { GoalKind } from "../plan";
import type { Track } from "../race/track";

export interface EventHit {
  id: number;
  name: string;
  /** YYYY-MM-DD, local to the event. */
  date: string;
  endDate: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  types: string[];
  kind: GoalKind;
  /** The earliest category start, "HH:MM", when listed. */
  startTime: string | null;
  /** Distances its categories list ("50 miles"). */
  distances: string[];
  url: string;
  website: string | null;
  /** The event's description (HTML), where course links often are. */
  notes: string;
}

/** BikeReg's "/Date(1768021200000-0500)/" as the event's local YYYY-MM-DD. */
export function bikeRegDate(value: unknown): string | null {
  const m = String(value ?? "").match(/Date\((-?\d+)([+-]\d{4})?\)/);
  if (!m) return null;
  const offset = m[2] ? (m[2][0] === "-" ? -1 : 1) * (Number(m[2].slice(1, 3)) * 60 + Number(m[2].slice(3))) : 0;
  return new Date(Number(m[1]) + offset * 60_000).toISOString().slice(0, 10);
}

/** Lactic's kind for BikeReg's event types (the first that maps), road race when none do. */
export function kindFromTypes(types: string[]): GoalKind {
  const t = types.map((x) => x.toLowerCase());
  const has = (...words: string[]) => t.some((x) => words.some((w) => x.includes(w)));
  if (has("cyclocross", "cyclo-cross")) return "cyclocross";
  if (has("criterium", "crit")) return "criterium";
  if (has("time trial")) return "timeTrial";
  if (has("hill climb", "hillclimb")) return "hillClimb";
  if (has("track")) return "track";
  if (has("gravel")) return "gravel";
  if (has("mountain", "mtb", "enduro", "xc", "fat bike")) return "mountainBike";
  if (has("gran fondo", "fondo", "tour", "century", "charity", "ride")) return "granFondo";
  return "roadRace";
}

type Raw = Record<string, unknown>;

/** BikeReg's search answer as events, soonest first, from `today` on. */
export function parseBikeRegSearch(json: unknown, today: string): EventHit[] {
  const list = ((json as Raw)?.MatchingEvents ?? []) as Raw[];
  const out: EventHit[] = [];
  for (const e of Array.isArray(list) ? list : []) {
    const date = bikeRegDate(e.EventDate);
    if (!date || date < today) continue;
    const types = Array.isArray(e.EventTypes) ? e.EventTypes.map(String) : [];
    const categories = Array.isArray(e.Categories) ? (e.Categories as Raw[]) : [];
    const starts = categories.map((c) => String(c.StartTime ?? "").slice(0, 5)).filter((s) => /^\d\d:\d\d$/.test(s) && s !== "00:00").sort();
    const distances = [...new Set(categories.map((c) => String(c.Distance ?? "").trim()).filter(Boolean))];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null);
    out.push({
      id: Number(e.EventId),
      name: String(e.EventName ?? "").trim(),
      date,
      endDate: bikeRegDate(e.EventEndDate) ?? date,
      city: String(e.EventCity ?? "").trim(),
      state: String(e.EventState ?? "").trim(),
      lat: num(e.Latitude),
      lng: num(e.Longitude),
      types,
      kind: kindFromTypes(types),
      startTime: starts[0] ?? null,
      distances: distances.slice(0, 6),
      url: String(e.EventPermalink ?? e.EventUrl ?? "").replace(/^http:/, "https:"),
      website: typeof e.EventWebsite === "string" && /^https?:\/\//.test(e.EventWebsite) ? e.EventWebsite : null,
      notes: String(e.EventNotes ?? ""),
    });
  }
  return out.filter((e) => e.name).sort((a, b) => a.date.localeCompare(b.date));
}

export interface CourseLink {
  kind: "rwgps" | "file" | "strava";
  url: string;
  /** What the page called it, when the link had text. */
  label: string | null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Course links in an event page's HTML: Ride with GPS routes and rides, GPX/TCX/FIT files, and Strava routes (which need a sign-in). */
export function findCourseLinks(html: string, base?: string): CourseLink[] {
  const out: CourseLink[] = [];
  const seen = new Set<string>();
  const add = (kind: CourseLink["kind"], url: string, label: string | null) => {
    const key = kind === "rwgps" ? (url.match(/(routes|trips)\/(\d+)/)?.slice(1).join("/") ?? url) : url;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, url, label: label && label.trim() ? label.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || null : null });
  };
  const anchors = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = anchors.exec(html); m; m = anchors.exec(html)) classify(decode(m[1]), m[2]);
  // Bare links in text.
  for (const m of html.matchAll(/https?:\/\/(?:www\.)?ridewithgps\.com\/(?:routes|trips)\/\d+/gi)) classify(m[0], null);
  function classify(href: string, label: string | null) {
    let url = href;
    try {
      url = new URL(href, base).toString();
    } catch {
      return;
    }
    const rw = url.match(/^https?:\/\/(?:www\.)?ridewithgps\.com\/(routes|trips)\/(\d+)/i);
    if (rw) return add("rwgps", `https://ridewithgps.com/${rw[1].toLowerCase()}/${rw[2]}`, label);
    if (/\.(gpx|tcx|fit)(\?|#|$)/i.test(url)) return add("file", url, label);
    if (/^https?:\/\/(?:www\.)?strava\.com\/routes\/\d+/i.test(url)) return add("strava", url, label);
  }
  // Ride with GPS first: it downloads without a sign-in.
  return out.sort((a, b) => order(a) - order(b));
}
const order = (l: CourseLink) => (l.kind === "rwgps" ? 0 : l.kind === "file" ? 1 : 2);

/** A Ride with GPS route or ride page's JSON (`/routes/123.json`) as a track. */
export function rwgpsTrack(json: unknown): Track {
  const root = json as Raw;
  const holder = ((root?.route ?? root?.trip ?? root) as Raw) ?? {};
  const pts = (holder.track_points ?? root?.track_points) as Raw[] | undefined;
  if (!Array.isArray(pts)) throw new Error("That Ride with GPS link has no route to read; is it public?");
  const points = pts
    .map((p) => ({ lat: Number(p.y), lng: Number(p.x), ele: typeof p.e === "number" ? p.e : null }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .map((p) => ({ t: null, lat: p.lat, lng: p.lng, ele: p.ele, hr: null, watts: null, cadence: null }));
  if (points.length < 2) throw new Error("That Ride with GPS route is empty");
  return { name: typeof holder.name === "string" ? holder.name : null, points };
}

/** The search URL for events named like `text` in `year` (BikeReg's public API). */
export function bikeRegSearchUrl(text: string, year: number): string {
  return `https://www.bikereg.com/api/search?${new URLSearchParams({ name: text.trim().slice(0, 80), year: String(year) })}`;
}
