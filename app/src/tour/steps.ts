// The tour's stops: each one opens a screen and points at a part of it.

import type { CoachMode } from "~/ai/settings";

export interface TourStep {
  id: string;
  /** The screen to open. */
  route?: string;
  /** data-tour value of the element to point at; none puts the card in the middle. */
  target?: string;
  title: string;
  body: string;
  /** Only shown for some coach modes. */
  coach?: CoachMode[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "hello",
    route: "/",
    title: "A quick look around",
    body: "What each screen is for, then a walk around the Ride screen so you know what you'll see on the bike.",
  },
  {
    id: "today",
    route: "/",
    target: "today",
    title: "Today",
    body: "Your morning check-in (recovery, weigh-in, how you feel), today's workout from your plan, your form and your last ride. Once you've ridden, it shows the ride against what was planned.",
  },
  {
    id: "plan",
    route: "/plan",
    target: "plan",
    title: "Plan",
    body: "Your plan's phases toward your goal, a fitness forecast, and each day's workout. Click a day to change it or drag it to another day. Add events, and breaks for travel or time off.",
  },
  {
    id: "progress",
    route: "/progress",
    target: "progress",
    title: "Progress",
    body: "Fitness, fatigue and form over the range you pick, your power curve and power profile, and every ride. Open a ride for its charts and route map.",
  },
  {
    id: "health",
    route: "/health",
    target: "health",
    title: "Health",
    body: "Recovery, sleep, HRV, resting heart rate and weight, from Apple Health and your scale. Tap any of them for its history.",
  },
  {
    id: "coach",
    route: "/",
    target: "coach",
    coach: ["builtin"],
    title: "Coach",
    body: "Ask about your training or for changes. The coach reads your numbers from Lactic and proposes plan changes for you to apply or dismiss. ⌘K opens it from any screen.",
  },
  {
    id: "coach-external",
    route: "/",
    target: "coach",
    coach: ["external"],
    title: "Your AI coach",
    body: "Your AI app reads your training through Lactic's MCP server. Changes it suggests show up in Lactic for you to apply or dismiss.",
  },
  {
    id: "settings",
    route: "/settings",
    target: "settings",
    title: "Settings",
    body: "Your profile and zones, appearance, the coach, connections (intervals.icu, Apple Health, FIT files), your Bluetooth gear, and a backup of your data.",
  },
  {
    id: "ride",
    route: "/",
    target: "ride",
    title: "Ride",
    body: "When you're on the bike, press Ride. Next, a look at what's on the Ride screen.",
  },
  {
    id: "ride-gear",
    route: "/ride",
    target: "ride-gear",
    title: "Your gear",
    body: "Trainer, power meter and heart rate. Paired gear reconnects by itself when you open Ride; connect anything that isn't here yet.",
  },
  {
    id: "ride-pick",
    route: "/ride",
    target: "ride-pick",
    title: "What to ride",
    body: "Today's planned workout comes first. Pick a workout instead (by type and length, or from My workouts, where .zwo files import), or Free ride at one ERG target you move as you go.",
  },
  {
    id: "ride-player",
    route: "/ride",
    target: "ride-player",
    title: "The workout",
    body: "Time left in the interval, your power against the target, heart rate and cadence, the workout chart and the ride so far. Lactic sets the trainer's resistance for each interval, so you just pedal. The controls pause, skip, make it easier or harder, and turn ERG off. Open overlay puts a small always-on-top version over Zwift.",
  },
  {
    id: "ride-editor",
    route: "/ride",
    target: "ride-editor",
    title: "Change the workout",
    body: "Adjust any interval before or during the ride, and save it to My workouts.",
  },
  {
    id: "ride-outside",
    route: "/ride",
    target: "ride-outside",
    title: "Ride it outside",
    body: "Sends the workout to your bike computer (Karoo, Garmin, Wahoo) through intervals.icu, in place of the day's planned one.",
  },
  {
    id: "ride-setup",
    route: "/ride",
    target: "ride-setup",
    title: "Ride setup",
    body: "Open Setup for: start when you pedal, open the overlay when you start, power from the trainer or a power meter, and this ride's FTP. Riding with Zwift open: pair Zwift for power, cadence and heart rate only, so Lactic keeps control of the trainer.",
  },
];

export const stepsFor = (mode: CoachMode) => TOUR_STEPS.filter((s) => !s.coach || s.coach.includes(mode));
