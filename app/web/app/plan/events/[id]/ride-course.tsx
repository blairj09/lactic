"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { button } from "@/components/ui";
import type { CourseProfile } from "@/lib/engine/course/profile";
import { courseSections, customSection, type CourseSection } from "@/lib/ride/course-ride";
import { distanceIn, distanceUnit, elevationIn, elevationUnit, M_PER_MILE } from "@/lib/units";
import { useUnits } from "@/lib/use-units";

/**
 * Ride part of the course indoors before the day: a climb, the finish, the whole thing, or any
 * stretch between two distances. Opens the Ride page with the trainer following that road.
 */
export default function RideCourse({ goalId, profile }: { goalId: string; profile: CourseProfile }) {
  const units = useUnits();
  const sections = useMemo(() => courseSections(profile), [profile]);
  const [picked, setPicked] = useState(sections[0].id);
  const per = units === "imperial" ? M_PER_MILE : 1000;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const custom = useMemo(() => {
    const a = Number(from);
    const b = Number(to);
    return from !== "" && to !== "" && Number.isFinite(a) && Number.isFinite(b) && b > a ? customSection(profile, a * per, b * per) : null;
  }, [from, to, per, profile]);
  const section: CourseSection = (picked === "custom" ? custom : sections.find((s) => s.id === picked)) ?? sections[0];
  const d = (m: number) => distanceIn(m, units).toFixed(1);
  const line = (s: CourseSection) =>
    `${d(s.from)}-${d(s.to)} ${distanceUnit(units)} · ${Math.round(elevationIn(s.gain, units))} ${elevationUnit(units)}${s.grade !== null ? ` · ${(s.grade * 100).toFixed(1)}%` : ""}`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Ride it on the trainer first. The trainer follows the road&apos;s grade, with the real terrain in 3D.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Part of the course">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={picked === s.id}
            onClick={() => setPicked(s.id)}
            className={`rounded-lg border px-3 py-2 text-left ${picked === s.id ? "border-accent bg-accent-soft" : "border-line hover:bg-raised"}`}
          >
            <div className="text-sm font-medium">{s.name}</div>
            <div className="num text-xs text-muted">{line(s)}</div>
          </button>
        ))}
        <div
          role="radio"
          aria-checked={picked === "custom"}
          tabIndex={0}
          onClick={() => setPicked("custom")}
          onKeyDown={(e) => e.key === "Enter" && setPicked("custom")}
          className={`rounded-lg border px-3 py-2 ${picked === "custom" ? "border-accent bg-accent-soft" : "border-line hover:bg-raised"}`}
        >
          <div className="text-sm font-medium">Your own stretch</div>
          <div className="num mt-1 flex items-center gap-1.5 text-xs text-muted">
            <input aria-label={`From, ${distanceUnit(units)}`} inputMode="decimal" placeholder="From" value={from} onChange={(e) => setFrom(e.target.value)} className="w-16 rounded border border-line bg-ground px-1.5 py-1 text-ink" />
            to
            <input aria-label={`To, ${distanceUnit(units)}`} inputMode="decimal" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} className="w-16 rounded border border-line bg-ground px-1.5 py-1 text-ink" />
            {distanceUnit(units)}
          </div>
        </div>
      </div>
      {picked === "custom" && !custom ? (
        <button type="button" className={button.primary} disabled>
          Ride it
        </button>
      ) : (
        <Link href={`/ride?course=${goalId}&section=${encodeURIComponent(section.id)}`} className={button.primary}>
          Ride {section.id.startsWith("custom") ? "it" : section.name.replace(/^The /, "the ").replace(/^Whole/, "the whole")}
        </Link>
      )}
    </div>
  );
}
