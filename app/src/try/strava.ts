// Posting a try-a-ride ride to the visitor's Strava (lactic.fit/ride/). Strava's sign-in opens in a
// popup so the ride stays in this tab; the popup lands on lactic.fit/strava/back.html, which hands the
// answer back here. The code and the ride's .fit file then go to lactic.fit/api/strava-post, which
// uploads the ride and disconnects Lactic from the visitor's Strava again. Nothing is kept.

import { stravaDescription, stravaTitle } from "@shared/strava/describe";
import type { Workout } from "@shared/engine/workout";

/** Strava's own orange, for its button. */
export const STRAVA_ORANGE = "#FC5200";
const RETURN_KEY = "lactic-strava-return";

export interface StravaRide {
  name: string;
  startedAt: string;
  workout: Workout;
}

/** The title and description Strava shows: the same words the app posts. */
export function stravaText(ride: Pick<StravaRide, "name" | "workout">): {
  name: string;
  description: string;
} {
  const posted = {
    name: ride.name,
    workout: ride.workout,
    durationSeconds: 0,
    averagePower: null,
    normalizedPower: null,
    trainingStress: null,
    intensityFactor: null,
    averageHr: null,
    intervals: null,
  };
  return { name: stravaTitle(posted), description: stravaDescription(posted) };
}

/** Lactic's Strava client id, or null when Strava isn't switched on (or lactic.fit can't be reached). */
export async function stravaClientId(): Promise<string | null> {
  try {
    // The full address: in this build "/api/..." is the app's own in-browser routes (platform/fetch.ts).
    const res = await fetch(`${location.origin}/api/strava`);
    if (!res.ok) return null;
    const body: { clientId?: string } = await res.json();
    return body.clientId && /^\d+$/.test(body.clientId) ? body.clientId : null;
  } catch {
    return null;
  }
}

export function authorizeUrl(clientId: string, origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:write",
    state,
    redirect_uri: `${origin}/strava/back.html`,
  });
  return `https://www.strava.com/oauth/authorize?${q}`;
}

/** Reads what Strava's sign-in sent back: the code, or why there isn't one. */
export function readReturn(search: string, state: string): { code: string } | { error: string } | null {
  const q = new URLSearchParams(search);
  if (q.get("state") !== state) return null;
  if (q.get("error"))
    return {
      error: "You didn't allow Lactic on Strava, so the ride wasn't posted.",
    };
  const code = q.get("code");
  if (!code) return { error: "Strava didn't finish the sign-in. Try again." };
  if (!(q.get("scope") ?? "").split(",").includes("activity:write"))
    return {
      error: "Lactic needs permission to upload your activity. Try again and leave that box ticked.",
    };
  return { code };
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Opens Strava's sign-in in a popup and resolves with the code once the visitor allows Lactic. Opens
 * the window straight away, from the click, so browsers don't block it.
 */
export function signIn(clientId: string): Promise<string> {
  const state = crypto.randomUUID().replace(/-/g, "");
  try {
    localStorage.removeItem(RETURN_KEY);
  } catch {
    // Private windows can refuse storage; the popup's message still arrives.
  }
  const popup = window.open(authorizeUrl(clientId, location.origin, state), "lactic-strava", "popup,width=600,height=780");
  if (!popup) return Promise.reject(new Error("Your browser blocked Strava's sign-in window. Allow pop-ups for lactic.fit and try again."));
  return new Promise((resolve, reject) => {
    const finish = (search: string) => {
      const answer = readReturn(search, state);
      if (!answer) return;
      stop();
      if ("error" in answer) reject(new Error(answer.error));
      else resolve(answer.code);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === "lactic-strava" && typeof e.data.search === "string") finish(e.data.search);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== RETURN_KEY || !e.newValue) return;
      try {
        finish(JSON.parse(e.newValue).search);
      } catch {
        // Not ours.
      }
    };
    // The visitor closed the popup without finishing.
    const closed = setInterval(() => {
      if (!popup.closed) return;
      // Give a last message from the popup a moment to arrive.
      setTimeout(() => {
        stop();
        reject(new Error("closed"));
      }, 800);
      clearInterval(closed);
    }, 500);
    const stop = () => {
      clearInterval(closed);
      window.removeEventListener("message", onMessage);
      window.removeEventListener("storage", onStorage);
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
  });
}

/** Posts the ride through lactic.fit; resolves with the Strava activity id (null while Strava is still making it). */
export async function postRide(code: string, ride: StravaRide, fit: Uint8Array): Promise<string | null> {
  const { name, description } = stravaText(ride);
  let res: Response;
  try {
    res = await fetch(`${location.origin}/api/strava-post`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code,
        fit: toBase64(fit),
        name,
        description,
        startedAt: new Date(ride.startedAt).toISOString(),
      }),
    });
  } catch {
    throw new Error("Couldn't reach lactic.fit. Check your connection and try again.");
  }
  const body: { activityId?: string | null; error?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Posting didn't work (${res.status}). Try again.`);
  return body.activityId ?? null;
}
