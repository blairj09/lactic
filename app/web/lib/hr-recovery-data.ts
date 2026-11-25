// Heart rate recovery across rides: each ride's drop, read from its stored stream by the engine.

import { loadHrStreams, loadRides, type Athlete } from "@/lib/activities";
import { ftpOn, localDate } from "@/lib/engine/activity";
import { hrRecovery } from "@/lib/engine/hr-recovery";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Weeks of rides your usual heart rate recovery is read from. */
export const USUAL_HRR_DAYS = 56;

export interface RideRecovery {
  rideId: string;
  /** Local day of the ride. */
  day: string;
  startedAt: Date;
  name: string | null;
  /** Mean drop over its efforts, bpm. */
  drop: number;
}

/** Every counted ride since `since` that had a hard effort to recover from, oldest first. */
export async function loadRideRecoveries(supabase: Supabase, athlete: Athlete, since: Date): Promise<RideRecovery[]> {
  const rides = await loadRides(supabase, since);
  const streams = await loadHrStreams(supabase, rides.map((r) => r.id));
  return rides
    .flatMap((r) => {
      const stream = streams.get(r.id);
      const day = localDate(r.startedAt, athlete.timezone);
      const found = stream ? hrRecovery(stream, ftpOn(day, athlete.ftpHistory, athlete.ftp)) : null;
      return found ? [{ rideId: r.id, day, startedAt: r.startedAt, name: r.name, drop: found.drop }] : [];
    })
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
