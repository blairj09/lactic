// Sends the plan to the intervals.icu calendar, so the Karoo and anything else linked there sees it.
// Rides go separately (client.ts sendRides), and only ones recorded here that Zwift or the Karoo didn't send.

import { addDays } from "../engine/pmc";
import type { OutdoorRide } from "../engine/outdoor";
import type { Goal, Plan } from "../engine/plan";
import { calendarChanges, calendarEvents, type ListedEvent } from "./calendar";
import { IntervalsError } from "./client";

const API = "https://intervals.icu/api/v1";

async function call(apiKey: string, method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: {
      authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString("base64")}`,
      "user-agent": "MyCoach/1.0 (+https://coach.jamesblair.me)",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) throw new IntervalsError("intervals.icu didn't accept the API key.");
  if (response.status === 429) throw new IntervalsError("intervals.icu's rate limit is reached. Try again in 15 minutes.");
  if (!response.ok) throw new IntervalsError(`intervals.icu ${method} ${path.split("?")[0]} failed (${response.status})`);
  return response;
}

export interface PushResult {
  sent: number;
  removed: number;
}

/** Brings the calendar from today on in line with the plan, touching only events this app made. */
export async function pushPlan(apiKey: string, plan: Plan, goals: Goal[], today: string, outdoor: OutdoorRide[] = []): Promise<PushResult> {
  const wanted = calendarEvents(plan, goals, today, outdoor);
  // Far enough ahead to find events for goals that have since been deleted.
  const listed: ListedEvent[] = await (await call(apiKey, "GET", `/athlete/0/events?oldest=${today}&newest=${addDays(today, 3 * 365)}`)).json();
  const { upsert, remove } = calendarChanges(wanted, listed, today);
  if (upsert.length) await call(apiKey, "POST", "/athlete/0/events/bulk?upsert=true", upsert);
  for (const id of remove) await call(apiKey, "DELETE", `/athlete/0/events/${id}`);
  return { sent: upsert.length, removed: remove.length };
}
