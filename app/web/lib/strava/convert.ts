// Strava activities and streams to rides. Pure, so it tests without the network.

import { resampleTo1Hz, summarizeRide, type StreamPoint } from "../engine/activity";
import type { NewRide } from "../activities";

/** The fields we use from Strava's SummaryActivity. */
export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  moving_time: number;
  distance: number;
  manual?: boolean;
}

/** Streams keyed by type, as returned with key_by_type=true. */
export type StravaStreams = Partial<Record<"time" | "watts" | "heartrate" | "cadence", { data: (number | null)[] }>>;

const RIDE_TYPES = new Set(["Ride", "VirtualRide", "GravelRide", "MountainBikeRide", "EBikeRide", "EMountainBikeRide", "Velomobile", "Handcycle"]);

export const isRide = (activity: Pick<StravaActivity, "sport_type">) => RIDE_TYPES.has(activity.sport_type);

export function rideFromStrava(activity: StravaActivity, streams: StravaStreams | null): NewRide {
  const time = streams?.time?.data ?? [];
  const at = (key: "watts" | "heartrate" | "cadence", i: number) => streams?.[key]?.data[i] ?? undefined;
  const points: StreamPoint[] = time.flatMap((t, i) =>
    t === null ? [] : [{ t, watts: at("watts", i), heartRate: at("heartrate", i), cadence: at("cadence", i) }],
  );
  const summary = points.length
    ? summarizeRide(resampleTo1Hz(points))
    : { durationSeconds: activity.moving_time, averagePower: null, normalizedPower: null, averageHeartRate: null, powerCurve: null, powerHistogram: null };
  return {
    source: "strava",
    externalId: String(activity.id),
    name: activity.name,
    startedAt: activity.start_date,
    distanceMeters: activity.distance || null,
    summary,
  };
}
