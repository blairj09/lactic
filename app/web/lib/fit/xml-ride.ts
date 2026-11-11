// Reads a recorded ride from a GPX or TCX file into the same shape the FIT decoder gives, so the
// importer treats it like any FIT ride. Indoor TCX files (no positions) are kept: only time is
// needed. Small tag scanners rather than DOMParser, so it runs anywhere and tests in Vitest.

import { FIT_SPORT_CYCLING, type FitActivity, type FitRecord } from "./decode";

/** FIT's "generic" sport, for files that say they're something other than a ride. */
const SPORT_OTHER = 0;

const tag = (body: string, name: string) => {
  // Matches <name>, <ns:name> and <ns3:name> alike.
  const m = body.match(new RegExp(`<(?:[\\w-]+:)?${name}>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}>`, "i"));
  return m ? m[1] : null;
};
const num = (s: string | null | undefined) => {
  if (s == null || s === "") return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
};
const attr = (head: string, name: string) => num(head.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1]);
const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

const position = (lat: number | undefined, lng: number | undefined) =>
  lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : {};

function activity(records: FitRecord[], sport: number | undefined, kind: string): FitActivity {
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (records.length < 2) throw new Error(`No timed points in this ${kind} file`);
  const lastDistance = records.findLast((r) => r.distance !== undefined)?.distance;
  return { sport, startTime: records[0].timestamp, totalDistanceMeters: lastDistance, records, laps: [] };
}

/** A recorded GPX track: points with times, plus heart rate, power and cadence from Garmin-style extensions. */
export function rideFromGpx(xml: string): { activity: FitActivity; name: string | null } {
  const trk = xml.match(/<trk\b[\s\S]*?<\/trk>/i)?.[0] ?? "";
  const name = trk.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i)?.[1]?.trim();
  // Strava writes <type>cycling</type> (or a number); others leave it out.
  const type = tag(trk, "type")?.toLowerCase();
  const sport = !type ? undefined : /cycl|bik|ride|^1$/.test(type) ? FIT_SPORT_CYCLING : SPORT_OTHER;
  const records: FitRecord[] = [];
  const re = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
  for (let m = re.exec(trk); m; m = re.exec(trk)) {
    const body = m[2] ?? "";
    const time = Date.parse(tag(body, "time") ?? "");
    if (!Number.isFinite(time)) continue;
    records.push({
      timestamp: new Date(time),
      ...position(attr(m[1], "lat"), attr(m[1], "lon")),
      altitude: num(tag(body, "ele")),
      heartRate: num(tag(body, "hr")) ?? num(tag(body, "heartrate")),
      power: num(tag(body, "power")) ?? num(tag(body, "watts")),
      cadence: num(tag(body, "cad")) ?? num(tag(body, "cadence")),
    });
  }
  return { activity: activity(records, sport, "GPX"), name: name ? unescape(name) || null : null };
}

/** A recorded TCX activity: every trackpoint with a time, with or without a position. */
export function rideFromTcx(xml: string): { activity: FitActivity; name: string | null } {
  const sportName = xml.match(/<(?:[\w-]+:)?Activity\b[^>]*\bSport\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const sport = !sportName || sportName === "other" ? undefined : sportName === "biking" ? FIT_SPORT_CYCLING : SPORT_OTHER;
  const records: FitRecord[] = [];
  const re = /<(?:[\w-]+:)?Trackpoint>([\s\S]*?)<\/(?:[\w-]+:)?Trackpoint>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const body = m[1];
    const time = Date.parse(tag(body, "Time") ?? "");
    if (!Number.isFinite(time)) continue;
    const hr = body.match(/<(?:[\w-]+:)?HeartRateBpm>[\s\S]*?<(?:[\w-]+:)?Value>\s*([\d.]+)/i)?.[1];
    records.push({
      timestamp: new Date(time),
      ...position(num(tag(body, "LatitudeDegrees")), num(tag(body, "LongitudeDegrees"))),
      altitude: num(tag(body, "AltitudeMeters")),
      distance: num(tag(body, "DistanceMeters")),
      heartRate: num(hr),
      power: num(tag(body, "Watts")),
      cadence: num(tag(body, "Cadence")),
    });
  }
  // TCX has no ride name; Notes is the closest.
  const notes = tag(xml, "Notes");
  return { activity: activity(records, sport, "TCX"), name: notes ? unescape(notes) || null : null };
}
