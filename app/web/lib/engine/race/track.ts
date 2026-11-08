// A rider's race as points on the ground: from the rider's own ride file, or a GPX file of another
// rider's race (Strava's "Export GPX"). Other riders' files often have no power or heart rate, and
// some have no times at all (Strava strips them from other people's activities), so every field but
// the position is optional. No browser or Node APIs, so it runs and tests anywhere.

export interface TrackPoint {
  /** Seconds since 1970, or null in a file without times. */
  t: number | null;
  lat: number;
  lng: number;
  /** Meters. */
  ele: number | null;
  hr: number | null;
  watts: number | null;
  cadence: number | null;
}

export interface Track {
  /** The name in the file (usually the activity's name), if any. */
  name: string | null;
  points: TrackPoint[];
}

/** A track as it's stored: one array per field, so a race is a few tens of kilobytes of JSON. */
export interface PackedTrack {
  name: string | null;
  t: (number | null)[];
  lat: number[];
  lng: number[];
  ele: (number | null)[];
  hr?: (number | null)[];
  watts?: (number | null)[];
  cadence?: (number | null)[];
}

const round = (v: number | null, places: number) => (v === null ? null : Math.round(v * 10 ** places) / 10 ** places);
const some = (values: (number | null)[]) => values.some((v) => v !== null);

export function packTrack(track: Track): PackedTrack {
  const p = track.points;
  const packed: PackedTrack = {
    name: track.name,
    t: p.map((x) => round(x.t, 1)),
    lat: p.map((x) => round(x.lat, 6) as number),
    lng: p.map((x) => round(x.lng, 6) as number),
    ele: p.map((x) => round(x.ele, 1)),
  };
  const hr = p.map((x) => x.hr);
  const watts = p.map((x) => x.watts);
  const cadence = p.map((x) => x.cadence);
  if (some(hr)) packed.hr = hr;
  if (some(watts)) packed.watts = watts;
  if (some(cadence)) packed.cadence = cadence;
  return packed;
}

export function unpackTrack(packed: PackedTrack): Track {
  return {
    name: packed.name ?? null,
    points: packed.lat.map((lat, i) => ({
      t: packed.t[i] ?? null,
      lat,
      lng: packed.lng[i],
      ele: packed.ele[i] ?? null,
      hr: packed.hr?.[i] ?? null,
      watts: packed.watts?.[i] ?? null,
      cadence: packed.cadence?.[i] ?? null,
    })),
  };
}

/** True when every point has a time. */
export const isTimed = (track: Track) => track.points.length > 0 && track.points.every((p) => p.t !== null);

const tag = (body: string, name: string) => {
  // Matches <name>, <ns:name> and <ns3:name> alike.
  const m = body.match(new RegExp(`<(?:[\\w-]+:)?${name}>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`, "i"));
  return m ? m[1] : null;
};
const num = (s: string | null) => {
  if (s === null || s === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};
const attr = (head: string, name: string) => {
  const m = head.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? num(m[1]) : null;
};
const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

/** Reads a GPX file's track (or, failing that, its route). Throws when there's nothing to read. */
export function parseGpx(xml: string): Track {
  const trk = xml.match(/<trk\b[\s\S]*?<\/trk>/i)?.[0];
  const nameMatch = (trk ?? xml).match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i);
  const points: TrackPoint[] = [];
  const re = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const lat = attr(m[2], "lat");
    const lng = attr(m[2], "lon");
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    const body = m[3] ?? "";
    const time = tag(body, "time");
    const t = time ? Date.parse(time) / 1000 : NaN;
    points.push({
      t: Number.isFinite(t) ? t : null,
      lat,
      lng,
      ele: num(tag(body, "ele")),
      hr: num(tag(body, "hr")) ?? num(tag(body, "heartrate")),
      watts: num(tag(body, "power")) ?? num(tag(body, "watts")),
      cadence: num(tag(body, "cad")) ?? num(tag(body, "cadence")),
    });
  }
  if (points.length < 2) throw new Error("No track points in this GPX file");
  // A file where only some points have times is treated as having none.
  if (points.some((p) => p.t === null)) for (const p of points) p.t = null;
  return { name: nameMatch ? unescape(nameMatch[1].trim()) || null : null, points };
}

/** A ride file's records as a track: the points that have a position. */
export function trackFromRecords(
  name: string | null,
  records: { timestamp: Date; lat?: number; lng?: number; altitude?: number; heartRate?: number; power?: number; cadence?: number }[],
): Track {
  const points: TrackPoint[] = [];
  for (const r of records) {
    if (r.lat === undefined || r.lng === undefined || (r.lat === 0 && r.lng === 0)) continue;
    points.push({
      t: r.timestamp.getTime() / 1000,
      lat: r.lat,
      lng: r.lng,
      ele: r.altitude ?? null,
      hr: r.heartRate ?? null,
      watts: r.power ?? null,
      cadence: r.cadence ?? null,
    });
  }
  if (points.length < 2) throw new Error("This ride has no GPS track");
  return { name, points };
}

/** Meters east and north of an origin, near enough over a race course. */
export interface Projection {
  x: (lat: number, lng: number) => number;
  y: (lat: number) => number;
  lat: (y: number) => number;
  lng: (x: number) => number;
}

export function projection(lat0: number, lng0: number): Projection {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const kx = R * toRad * Math.cos(lat0 * toRad);
  const ky = R * toRad;
  return {
    x: (_lat, lng) => (lng - lng0) * kx,
    y: (lat) => (lat - lat0) * ky,
    lat: (y) => lat0 + y / ky,
    lng: (x) => lng0 + x / kx,
  };
}
