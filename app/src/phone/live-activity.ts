// Keeps the iPhone's ride Live Activity (lock screen and Dynamic Island) in step with the ride: the
// phone's own (ride screen) or the computer's seen through the remote (remote.tsx). Each hands over
// the ride as it changes; this words it (web/lib/ride/live-activity.ts), sends only what's worth
// sending, and ends the activity when the ride goes. iOS only starts one while Lactic is open on
// screen; a refused start is tried again with the next update.

import { useEffect } from "react";
import { liveActivity, worthSending, type LiveActivityState, type LiveRide } from "@/lib/ride/live-activity";
import { isPhone } from "~/platform/native";
import { endRideActivity, rideActivity } from "./plugin";

/** Even with nothing new, hand it over this often (ms), so it doesn't go stale while we can still hear the ride. */
const REFRESH = 10_000;

let last: LiveActivityState | null = null;
let lastAt = 0;
let busy = false;

/** The ride as it is now (null: no ride any more). `place` names the computer for its ride. */
export function showRide(ride: LiveRide | null, place: string | null = null) {
  if (!isPhone()) return;
  const now = Date.now();
  const next = liveActivity(ride, now, place);
  if (!next) {
    if (last) {
      const linger = last.phase === "done" || !!ride?.ended;
      last = null;
      void endRideActivity(linger).catch(() => {});
    }
    return;
  }
  if (busy || (!worthSending(last, lastAt, next, now) && now - lastAt < REFRESH)) return;
  busy = true;
  rideActivity(next)
    .then(() => {
      last = next;
      lastAt = now;
    })
    // Not started (in the background, or Live Activities off for Lactic): try again next time.
    .catch(() => {})
    .finally(() => {
      busy = false;
    });
}

/** The phone's own ride screen renders this with its player data; leaving the screen ends it. */
export function LiveActivityHost({ ride }: { ride: LiveRide }) {
  useEffect(() => {
    showRide(ride);
  });
  useEffect(() => () => showRide(null), []);
  return null;
}
