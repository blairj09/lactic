import { gridTimes, resampleTo1Hz, summarizeRide, type ActivitySource, type RideSummary } from "../engine/activity";
import { streamFromResampled, thinRoute, type ChartStream } from "../engine/ride-detail";
import { decodeFit, FIT_MANUFACTURER, FIT_SPORT_CYCLING, type FitActivity } from "./decode";
import { rideFromGpx, rideFromTcx } from "./xml-ride";

/** A ride ready to store, before FTP-dependent numbers are added. */
export interface ImportedRide {
  source: ActivitySource;
  externalId: string;
  name: string;
  startedAt: string;
  distanceMeters: number | null;
  summary: RideSummary;
  stream: ChartStream;
}

export function rideFromFit(fit: FitActivity, fileName: string): ImportedRide {
  const first = fit.records[0];
  const startedAt = fit.startTime ?? first?.timestamp;
  if (!startedAt || !first) throw new Error("No ride data in this file");

  const origin = first.timestamp.getTime();
  const times = fit.records.map((r) => (r.timestamp.getTime() - origin) / 1000);
  const stream = resampleTo1Hz(fit.records.map((r, i) => ({ t: times[i], watts: r.power, heartRate: r.heartRate, cadence: r.cadence })));
  const at = gridTimes(times);
  const source: ActivitySource =
    fit.manufacturer === FIT_MANUFACTURER.zwift ? "zwift_fit" : fit.manufacturer === FIT_MANUFACTURER.hammerhead ? "karoo_fit" : "fit";
  const lastDistance = fit.records.findLast((r) => r.distance !== undefined)?.distance;

  return {
    source,
    // The same file imported twice gets the same id, so it isn't stored twice.
    externalId: `${fit.manufacturer ?? "unknown"}-${fit.serialNumber ?? 0}-${startedAt.toISOString()}`,
    name: fileName.replace(/\.(fit|gpx|tcx)$/i, "") || defaultName(source),
    startedAt: startedAt.toISOString(),
    distanceMeters: fit.totalDistanceMeters ?? lastDistance ?? null,
    summary: summarizeRide(stream),
    // Zwift files carry made-up positions in its virtual worlds, so only real rides keep a route.
    stream: { ...streamFromResampled(stream), route: source === "zwift_fit" ? null : thinRoute(fit.records.map((r, i) => ({ lat: r.lat, lng: r.lng, t: at[i] }))) },
  };
}

const defaultName = (source: ActivitySource) => (source === "zwift_fit" ? "Zwift ride" : source === "karoo_fit" ? "Karoo ride" : "Ride");

/** File names the ride importer reads (each may also be gzipped). */
export const RIDE_FILE = /\.(fit|gpx|tcx)(\.gz)?$/i;

/**
 * A ride from a FIT, GPX or TCX file's bytes (already un-gzipped), told apart by content. Null when
 * the file says it's another sport. Throws when it can't be read.
 */
export function rideFromFile(bytes: Uint8Array, fileName: string): ImportedRide | null {
  const name = fileName.replace(/\.gz$/i, "");
  const isFit = bytes.length > 12 && String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === ".FIT";
  let fit: FitActivity;
  let title = name;
  if (isFit) fit = decodeFit(bytes);
  else {
    const text = new TextDecoder().decode(bytes);
    const read = /<gpx[\s>]/i.test(text) ? rideFromGpx(text) : /<TrainingCenterDatabase[\s>]/i.test(text) ? rideFromTcx(text) : null;
    if (!read) throw new Error("Not a FIT, GPX or TCX file");
    fit = read.activity;
    if (read.name) title = read.name;
  }
  if (fit.sport !== undefined && fit.sport !== FIT_SPORT_CYCLING) return null;
  return rideFromFit(fit, title);
}
