"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { button, input } from "@/components/ui";
import type { LinkOption } from "@/lib/training";
import { countRideFor } from "../actions";

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * Which planned workout a ride counts for: the day it was ridden by default, or a planned day near it you
 * pick (an outdoor ride in place of the day's endurance, a session ridden a day late). Suggests the open
 * planned day nearby when the ride's own day had nothing planned.
 */
export default function CountFor({
  rideId,
  ridden,
  current,
  options,
  suggestion,
}: {
  rideId: string;
  /** The day the ride was ridden. */
  ridden: string;
  /** The day it counts for now. */
  current: string;
  /** Planned days it could count for, nearest first. */
  options: LinkOption[];
  suggestion: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ownPlanned = options.some((o) => o.date === ridden);
  const choices = ownPlanned ? options : [{ date: ridden, label: "nothing planned" }, ...options];
  const suggested = suggestion ? options.find((o) => o.date === suggestion) : undefined;

  const choose = (day: string) =>
    start(async () => {
      const result = await countRideFor(rideId, day === ridden && !ownPlanned ? null : day);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });

  return (
    <div className="mt-5 space-y-3 border-t border-rule pt-4 text-sm">
      {suggested && current === ridden && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-muted">
            Nothing was planned the day you rode this. Did it stand in for {weekday(suggested.date)}&apos;s {suggested.label.toLowerCase()}?
          </span>
          <button className={button.smallPrimary} disabled={pending} onClick={() => choose(suggested.date)}>
            Count it for {weekday(suggested.date)}
          </button>
        </div>
      )}
      <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-muted">Counts for</span>
        <select className={`${input} max-w-full`} value={current} disabled={pending} onChange={(e) => choose(e.target.value)}>
          {choices.map((o) => (
            <option key={o.date} value={o.date}>
              {dayLabel(o.date)}
              {o.date === ridden ? " (the day you rode)" : ""} · {o.label}
            </option>
          ))}
        </select>
      </label>
      {message && <p className={message.ok ? "text-muted" : "text-negative"}>{message.text}</p>}
    </div>
  );
}
