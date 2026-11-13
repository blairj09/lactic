// Which page the athlete has open when they message the coach, so "this ride" or "this range"
// means something. Built from the path and query only; the coach reads the data itself with tools.

const DATE = /^\d{4}-\d\d-\d\d$/;

const PAGES: Record<string, string> = {
  "/": "Today: the morning routine (recovery, a weekly weigh-in when one is due, how they feel), the morning brief with today's options, and today's session",
  "/plan": "Plan: the training plan by week, phases and the fitness forecast (Calendar tab); the plan's dates and goal, events, time available and breaks (Setup tab)",
  "/ride": "Ride: the workout player that controls the trainer",
  "/progress": "Progress: fitness, fatigue and form, power curve, power profile and power distribution over a date range, VO2 max and fitness age now (Trends tab); every ride as a month calendar or a list with search and filters (Rides tab)",
  "/health": "Health: last night's recovery, HRV, resting HR, sleep stages, breathing rate and wrist temperature from Apple Health, their 30-day trends, and weigh-ins on the scale with the body weight trend",
  "/settings": "Settings: FTP, heart rate, body details, the coach, and connections (intervals.icu, Bluetooth devices, the Apple Health shortcut, FIT import)",
};

/** A line for the coach's prompt about the page the athlete is on, or null for an unknown one. */
export function describePage(path: string, search = ""): string | null {
  const page = PAGES[path.replace(/\/+$/, "") || "/"];
  if (!page) return null;
  const params = new URLSearchParams(search);
  const date = (key: string) => {
    const value = params.get(key);
    return value && DATE.test(value) ? value : null;
  };
  const details: string[] = [];
  if (path === "/ride" && date("day")) details.push(`the planned session for ${date("day")} is loaded`);
  if (path === "/progress" && params.get("tab") === "rides") details.push("the Rides tab is open");
  else if (path === "/progress") {
    const from = date("from");
    const to = date("to");
    details.push(from && to ? `the range shown is ${from} to ${to}` : "the range shown is the last 3 months");
    const compare = params.get("compare");
    if (compare === "previous") details.push("compared with the period before it");
    if (compare === "lastYear") details.push("compared with the same range a year earlier");
  }
  return `The athlete has this page open while they talk to you: ${page}${details.length ? ` (${details.join(", ")})` : ""}. When they say "this" or "here", they probably mean what's on it.`;
}
