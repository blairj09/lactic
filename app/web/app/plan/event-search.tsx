"use client";

import { useState, useTransition } from "react";
import { button, input } from "@/components/ui";
import { GOAL_KIND_LABELS } from "@/lib/engine/plan";
import type { CourseLink, EventHit } from "@/lib/engine/course/events";
import { findCourseFor, findEvents } from "./course-actions";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Search for the race instead of typing it in: picking one fills in its name, date, kind and start,
 * and looks for its course on the listing and the event's website.
 */
export default function EventSearch({ onPick }: { onPick: (event: EventHit, course: CourseLink | null) => void }) {
  const [text, setText] = useState("");
  const [events, setEvents] = useState<EventHit[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState<number | null>(null);

  const search = () =>
    start(async () => {
      setMessage(null);
      const r = await findEvents(text);
      if (!r.ok) {
        setEvents(null);
        setMessage(r.message);
        return;
      }
      setEvents(r.events);
      if (!r.events.length) setMessage("No upcoming events by that name. Try a shorter part of it, or fill in the event below.");
    });

  const pick = (e: EventHit) =>
    start(async () => {
      setPicking(e.id);
      const links = await findCourseFor({ notes: e.notes, website: e.website });
      const course = links.find((l) => l.kind !== "strava") ?? null;
      onPick(e, course);
      setEvents(null);
      setPicking(null);
      setMessage(
        course
          ? `Found ${e.name}, and a course on its ${course.kind === "rwgps" ? "Ride with GPS link" : "page"}. Check the details below.`
          : links.length
            ? `Found ${e.name}. Its course is on Strava, which needs a sign-in: export the GPX there and attach it below.`
            : `Found ${e.name}. No course file on its listing or website; attach one below if you have it.`,
      );
    });

  return (
    <div className="space-y-2 rounded-lg border border-line bg-raised/40 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Find your race by name"
          aria-label="Find your race by name"
          className={`${input} min-w-0 flex-1`}
        />
        <button type="button" className={button.secondary} disabled={pending || text.trim().length < 3} onClick={search}>
          {pending && picking === null ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="text-xs text-muted">US races and rides listed on BikeReg. Elsewhere, fill in the event and attach its course below.</p>
      {events && events.length > 0 && (
        <ul className="max-h-72 divide-y divide-rule overflow-y-auto rounded-md border border-line bg-surface">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-raised disabled:opacity-60" disabled={pending} onClick={() => pick(e)}>
                <span className="block font-medium">{e.name}</span>
                <span className="block text-xs text-muted">
                  {day(e.date)} · {[e.city, e.state].filter(Boolean).join(", ")} · {e.types.slice(0, 3).join(", ") || GOAL_KIND_LABELS[e.kind]}
                  {picking === e.id ? " · looking for the course…" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}
