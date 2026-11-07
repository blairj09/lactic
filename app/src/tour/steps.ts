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
    body: "What each screen is for, then what you'll see on the bike.",
  },
  {
    id: "today",
    route: "/",
    target: "today",
    title: "Today",
    body: "Your morning check-in, today's workout, your form and your last ride. After you ride, it shows how it compared with the plan.",
  },
  {
    id: "plan",
    route: "/plan",
    target: "plan",
    title: "Plan",
    body: "Your plan week by week, with a fitness forecast. Click a day to change it, or drag it to another day. Add events and breaks in Setup.",
  },
  {
    id: "progress",
    route: "/progress",
    target: "progress",
    title: "Progress",
    body: "Fitness, power curve and profile over any range, and every ride. Open a ride for its charts and map.",
  },
  {
    id: "health",
    route: "/health",
    target: "health",
    title: "Health",
    body: "Recovery, sleep, HRV, resting heart rate and weight. Click any of them for its history.",
  },
  {
    id: "coach",
    route: "/",
    target: "coach",
    coach: ["builtin"],
    title: "Coach",
    body: "Ask about your training or for changes. It reads your numbers and suggests changes for you to apply or dismiss. ⌘K opens it anywhere.",
  },
  {
    id: "coach-external",
    route: "/",
    target: "coach",
    coach: ["external"],
    title: "Your AI coach",
    body: "Your AI app reads your training through Lactic's MCP server. Changes it suggests show up here for you to apply or dismiss.",
  },
  {
    id: "settings",
    route: "/settings",
    target: "settings",
    title: "Settings",
    body: "Your profile and zones, the coach, connections, Bluetooth gear and backups.",
  },
  {
    id: "ride",
    route: "/",
    target: "ride",
    title: "Ride",
    body: "On the bike, press Ride. Here's what you'll see.",
  },
  {
    id: "ride-gear",
    route: "/ride",
    target: "ride-gear",
    title: "Your gear",
    body: "Trainer, power meter and heart rate. Paired gear reconnects on its own.",
  },
  {
    id: "ride-pick",
    route: "/ride",
    target: "ride-pick",
    title: "What to ride",
    body: "Today's workout comes first. Or pick another, import a .zwo, or free ride at one ERG target.",
  },
  {
    id: "ride-player",
    route: "/ride",
    target: "ride-player",
    title: "The workout",
    body: "Time left, power against the target, heart rate and cadence. Lactic sets the trainer's resistance, so you just pedal. Open overlay for a small window that stays on top of other apps, like Zwift or a video.",
  },
  {
    id: "ride-editor",
    route: "/ride",
    target: "ride-editor",
    title: "Change the workout",
    body: "Adjust any interval, even mid-ride, and save it to My workouts.",
  },
  {
    id: "ride-outside",
    route: "/ride",
    target: "ride-outside",
    title: "Ride it outside",
    body: "Send the workout to your bike computer through intervals.icu.",
  },
  {
    id: "ride-setup",
    route: "/ride",
    target: "ride-setup",
    title: "Ride setup",
    body: "Auto-start, the overlay, power source and this ride's FTP. With Zwift open, pair Zwift for power, cadence and heart rate only, so Lactic keeps control of the trainer.",
  },
];

export const stepsFor = (mode: CoachMode) => TOUR_STEPS.filter((s) => !s.coach || s.coach.includes(mode));
