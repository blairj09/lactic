"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExperimentalTag } from "@/components/experimental-tag";
import { Result, button, fileInput, input } from "@/components/ui";
import { COURSE_TYPE_LABELS } from "@/lib/engine/course/profile";
import type { Goal } from "@/lib/engine/plan";
import type { ActionResult } from "../actions";
import { formatDistance, formatElevation } from "@/lib/units";
import { useUnits } from "@/lib/use-units";
import { deleteCourse, linkCourse, uploadCourse } from "./course-actions";

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** An event's course file in its edit dialog: attach one, replace or remove it, and open the pre-race report. */
export default function CourseField({ goal, titled = true }: { goal: Goal; titled?: boolean }) {
  const units = useUnits();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const run = (work: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await work();
      setResult(r);
      if (r.ok) router.refresh();
    });
  const c = goal.course;
  return (
    <div className={`space-y-2 text-sm ${titled ? "border-t border-rule pt-4" : ""}`}>
      {titled && (
        <div className="flex items-center gap-2 font-medium">
          Course <ExperimentalTag />
        </div>
      )}
      {c ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {formatDistance(c.km * 1000, units)} · {formatElevation(c.gain, units)} up · {COURSE_TYPE_LABELS[c.type]}
            {c.climbs.length ? ` · ${c.climbs.length === 5 ? "5+" : c.climbs.length} climb${c.climbs.length === 1 ? "" : "s"}` : ""}
          </span>
          <Link href={`/plan/events/${goal.id}`} className="text-accent underline-offset-4 hover:underline">
            Pre-race report
          </Link>
          <button type="button" className="text-muted underline-offset-4 hover:text-negative hover:underline" disabled={pending} onClick={() => run(() => deleteCourse(goal.id))}>
            Remove course
          </button>
        </div>
      ) : (
        <p className="text-muted">Attach the course (GPX, TCX or FIT) for a pre-race report, and so the plan trains for its climbs.</p>
      )}
      <input
        type="file"
        accept=".gpx,.tcx,.fit"
        className={fileInput}
        aria-label={c ? "Replace the course file" : "Course file"}
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) run(async () => uploadCourse(goal.id, f.name, await readBase64(f)));
          e.target.value = "";
        }}
      />
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const url = String(new FormData(e.currentTarget).get("url") ?? "").trim();
          if (url) run(() => linkCourse(goal.id, url));
        }}
      >
        <input name="url" placeholder="or a link: Ride with GPS, or a GPX file on the web" aria-label="Course link" className={`${input} min-w-0 flex-1`} disabled={pending} />
        <button className={button.secondary} disabled={pending}>
          Use link
        </button>
      </form>
      {pending && <p className="text-muted">Reading the course…</p>}
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </div>
  );
}
