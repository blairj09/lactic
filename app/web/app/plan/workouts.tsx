"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { plannedStress, workoutDuration, type Workout } from "@/lib/engine/workout";
import { customKey, libraryKey, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, WORKOUT_LIBRARY, libraryWorkout, type LibraryCategory, type LibraryWorkout } from "@/lib/engine/workout-library";
import type { CustomWorkout } from "@/lib/custom-workouts";
import FavoriteButton from "@/components/favorite-button";
import { WorkoutRow, WorkoutSheet } from "@/components/workout-list";
import { Segmented, button, input } from "@/components/ui";
import Select from "@/components/select";
import { formatTime } from "../ride/player";
import { setFavorite } from "../ride/actions";
import { saveDayFixed } from "./actions";
import type { ActionResult } from "../actions";

type Shelf = "library" | "saved" | "favorites";

/** A workout in the lists: the starter library's or one of yours, with its favorite key. */
interface Entry {
  key: string;
  name: string;
  /** The row's line of numbers; `detail` is the page's, with the type. */
  line: string;
  detail: string;
  workout: Workout;
  description?: string;
  category?: LibraryCategory;
}

const line = (duration: number, stress: number, level?: number) => `${formatTime(duration)} · TSS ${Math.round(stress)}${level !== undefined ? ` · level ${level}` : ""}`;

/** Levels don't move on recovery spins and tests, so they don't show one. */
const shownLevel = (w: LibraryWorkout) => (w.category === "recovery" || w.category === "tests" ? undefined : w.level);

/** `typed` puts the type first, for lists not already narrowed to one. */
const fromLibrary = (w: LibraryWorkout, typed = true): Entry => ({
  key: libraryKey(w.id),
  name: w.workout.name,
  line: typed ? `${LIBRARY_CATEGORY_LABELS[w.category]} · ${line(w.duration, w.stress, shownLevel(w))}` : line(w.duration, w.stress, shownLevel(w)),
  detail: `${LIBRARY_CATEGORY_LABELS[w.category]} · ${line(w.duration, w.stress, shownLevel(w))}`,
  workout: w.workout,
  description: w.description,
  category: w.category,
});

const fromSaved = (s: CustomWorkout): Entry => ({
  key: customKey(s.id),
  name: s.workout.name,
  line: line(workoutDuration(s.workout), plannedStress(s.workout)),
  detail: line(workoutDuration(s.workout), plannedStress(s.workout)),
  workout: s.workout,
});

/**
 * Plan → Workouts: the starter library, your saved workouts and your favorites, each with its shape.
 * A workout opens to its page, to ride now or put on a day.
 */
export default function Workouts({
  saved,
  favorites: initialFavorites,
  ftp,
  days,
}: {
  saved: CustomWorkout[];
  /** Favorite keys, newest first. */
  favorites: string[];
  ftp: number | null;
  /** Days a workout can go on: today (unless ridden) through the change window. */
  days: { date: string; label: string }[];
}) {
  const router = useRouter();
  const [shelf, setShelf] = useState<Shelf>("library");
  const [category, setCategory] = useState<LibraryCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [open, setOpen] = useState<Entry | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const entries = useMemo(() => {
    const words = query.trim().toLowerCase();
    const matches = (e: Entry) => !words || e.name.toLowerCase().includes(words);
    if (shelf === "library") return WORKOUT_LIBRARY.filter((w) => category === "all" || w.category === category).map((w) => fromLibrary(w, category === "all")).filter(matches);
    if (shelf === "saved") return saved.map(fromSaved).filter(matches);
    return favorites
      .flatMap((key) => {
        if (key.startsWith("library:")) {
          const w = libraryWorkout(key.slice(8));
          return w ? [fromLibrary(w)] : [];
        }
        const s = saved.find((x) => customKey(x.id) === key);
        return s ? [fromSaved(s)] : [];
      })
      .filter(matches);
  }, [shelf, category, query, saved, favorites]);

  /** Adds a workout to favorites or takes it off, on screen first and then in the database. */
  const toggle = async (key: string) => {
    const on = !favorites.includes(key);
    const before = favorites;
    setFavorites(on ? [key, ...favorites] : favorites.filter((k) => k !== key));
    const r = await setFavorite(key, on);
    if (!r.ok) {
      setFavorites(before);
      setError(r.message);
    }
  };

  const heart = (e: Entry) => <FavoriteButton on={favorites.includes(e.key)} name={e.name} onToggle={() => void toggle(e.key)} />;

  const addTo = (date: string) =>
    open &&
    start(async () => {
      const r = await saveDayFixed(date, open.key);
      setResult(r);
      if (r.ok) router.refresh();
    });

  const shelves: { value: Shelf; label: string }[] = [
    { value: "library", label: "Library" },
    { value: "saved", label: `Saved${saved.length ? ` (${saved.length})` : ""}` },
    { value: "favorites", label: `Favorites${favorites.length ? ` (${favorites.length})` : ""}` },
  ];

  return (
    <div className="space-y-3">
      <Segmented label="Workouts" options={shelves} value={shelf} onChange={setShelf} />
      <input type="search" aria-label="Search workouts" placeholder="Search workouts" value={query} onChange={(e) => setQuery(e.target.value)} className={`${input} w-full sm:w-80`} />
      {shelf === "library" && (
        <div role="radiogroup" aria-label="Type" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {(["all", ...LIBRARY_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className="shrink-0 rounded-full border border-control px-3 py-1 text-sm whitespace-nowrap text-muted transition-colors hover:text-ink aria-checked:border-primary aria-checked:bg-primary aria-checked:text-on-primary"
            >
              {c === "all" ? "All" : LIBRARY_CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}

      {entries.length ? (
        <ul className="grid divide-y divide-rule border-y border-rule md:grid-cols-2 md:gap-x-8 md:divide-y-0 md:border-y-0 md:[&>li]:border-b md:[&>li]:border-rule">
          {entries.map((e) => (
            <WorkoutRow
              key={e.key}
              name={e.name}
              line={e.line}
              workout={e.workout}
              onOpen={() => {
                setResult(null);
                setOpen(e);
              }}
              actions={heart(e)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          {query
            ? "No workouts match."
            : shelf === "saved"
              ? "Nothing saved yet. Build or import one on the Ride page."
              : "No favorites yet. Tap the heart on a workout you like."}
        </p>
      )}

      {open && (
        <WorkoutSheet name={open.name} line={open.detail} workout={open.workout} description={open.description} ftp={ftp} onClose={() => setOpen(null)}>
          <Link href={`/ride?workout=${encodeURIComponent(open.key)}`} className={button.primary}>
            Ride now
          </Link>
          {days.length > 0 && (
            <Select aria-label="Add to a day" value="" disabled={pending} onChange={(date) => date && addTo(date)} className={`${input} w-44`}>
              <option value="">{pending ? "Adding…" : "Add to a day"}</option>
              {days.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
          {heart(open)}
          {result && <p className={`w-full text-sm ${result.ok ? "text-muted" : "text-negative"}`}>{result.message}</p>}
        </WorkoutSheet>
      )}
    </div>
  );
}
