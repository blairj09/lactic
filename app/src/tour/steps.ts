// The tour's stops: each one opens a screen and points at its place in the top bar.

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
    body: "Two minutes: what each screen is for, then a demo ride on a simulated trainer so you can see how riding works before you clip in.",
  },
  {
    id: "today",
    route: "/",
    target: "today",
    title: "Today",
    body: "Where you start each day: today's workout from your plan, your form, and your recovery once sleep data comes in. After a ride it shows what you did against what was planned.",
  },
  {
    id: "plan",
    route: "/plan",
    target: "plan",
    title: "Plan",
    body: "Your weeks ahead, built around the time you have and your goal. Click a day to change it, drag a workout to swap days, and add races or time off. The plan adjusts as you ride.",
  },
  {
    id: "progress",
    route: "/progress",
    target: "progress",
    title: "Progress",
    body: "Fitness, fatigue and form over time, your power curve, and every ride. Open a ride for its charts, laps and map.",
  },
  {
    id: "health",
    route: "/health",
    target: "health",
    title: "Health",
    body: "Sleep, HRV, resting heart rate and weight, with a daily recovery score. Lactic uses it to tell you when to push and when to back off.",
  },
  {
    id: "coach",
    route: "/",
    target: "coach",
    coach: ["builtin"],
    title: "Coach",
    body: "Ask about your training, or ask for changes. The coach reads your numbers from Lactic and proposes plan changes you can apply or dismiss. ⌘K opens it from anywhere.",
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
    body: "Everything from setup lives here, so you can finish it any time: your zones, gear, ride history, health data and coach.",
  },
  {
    id: "ride",
    route: "/",
    target: "ride",
    title: "Ride",
    body: "On the bike, press Ride. Lactic connects your trainer and sets its resistance for every interval, so you just pedal. Zwift can stay open for the scenery; it only reads power, cadence and heart rate.",
  },
];

export const stepsFor = (mode: CoachMode) => TOUR_STEPS.filter((s) => !s.coach || s.coach.includes(mode));
