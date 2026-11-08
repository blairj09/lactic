"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { button, fileInput, input, Result } from "@/components/ui";
import Select from "@/components/select";
import type { ResultRow } from "@/lib/engine/race/results";
import { deleteRival, loadOwnTrack, readResultsScreenshot, saveRaceResults, uploadOwnTrack, uploadRival } from "./actions";

export interface RivalInfo {
  id: string;
  name: string;
  points: number;
  timed: boolean;
}

const readFile = (file: File, as: "base64" | "dataUrl") =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      resolve(as === "dataUrl" ? url : url.slice(url.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-x-3 gap-y-2">
      <span className={`num mt-0.5 flex size-6 items-center justify-center rounded-full text-xs font-medium ${done ? "bg-positive text-surface" : "bg-raised text-ink"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/** What a race report needs: your own ride file, other riders' GPX files, and (optionally) the results. */
export default function RaceSetup({
  activityId,
  ownPoints,
  canFetch,
  rivals,
  resultsText,
  results,
  ownName,
}: {
  activityId: string;
  ownPoints: number | null;
  canFetch: boolean;
  rivals: RivalInfo[];
  resultsText: string;
  results: ResultRow[];
  ownName: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState(resultsText);
  const [me, setMe] = useState(ownName ?? "");
  const [rivalName, setRivalName] = useState("");
  const [rivalFile, setRivalFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const rows = results;

  const run = (work: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await work();
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-6">
      <Step n={1} title="Your ride file" done={ownPoints !== null}>
        {ownPoints !== null ? (
          <p className="text-sm text-muted">Your GPS track, {ownPoints.toLocaleString()} points.</p>
        ) : (
          <p className="text-sm text-muted">The report needs your ride at full detail. {canFetch ? "Lactic can get it from intervals.icu, or drop in the file from your device." : "Drop in the FIT or GPX file from your device."}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {canFetch && ownPoints === null && (
            <button type="button" className={button.primary} disabled={pending} onClick={() => run(() => loadOwnTrack(activityId))}>
              Get it from intervals.icu
            </button>
          )}
          <input
            type="file"
            accept=".fit,.gpx"
            className={fileInput}
            disabled={pending}
            aria-label="Your ride file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) run(async () => uploadOwnTrack(activityId, f.name, await readFile(f, "base64")));
            }}
          />
        </div>
      </Step>

      <Step n={2} title="Results (optional, but they sharpen everything)" done={rows.length > 0}>
        <p className="text-sm text-muted">Paste them from the timing site, one rider per line, or read them off a screenshot. Lap times line everyone up exactly, and give GPX files without times a clock.</p>
        <textarea
          className={`${input} h-32 w-full py-2 font-mono text-xs`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"1  STOWE, Jaxson  40:30  8:12 8:08 7:54 8:08 8:08\n2  BAKER, Matt   40:52  8:14 8:08 8:06 8:16 8:08"}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${button.secondary} cursor-pointer ${reading ? "opacity-50" : ""}`}>
            {reading ? "Reading…" : "Read a screenshot"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={reading}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setReading(true);
                const r = await readResultsScreenshot(await readFile(f, "dataUrl"));
                setReading(false);
                setMessage({ ok: r.ok, text: r.message });
                if (r.ok && r.text) setText(r.text);
              }}
            />
          </label>
          {rows.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">You are</span>
              <Select className={input} value={me} onChange={(v) => setMe(v)} aria-label="Which rider is you">
                <option value="">Pick yourself</option>
                {rows.map((r) => (
                  <option key={r.place} value={r.name}>
                    {r.place}. {r.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <button type="button" className={button.primary} disabled={pending} onClick={() => run(() => saveRaceResults(activityId, text, me || null))}>
            Save results
          </button>
        </div>
      </Step>

      <Step n={3} title="Riders to compare with" done={rivals.length > 0}>
        <p className="text-sm text-muted">Best: their original file from their device or intervals.icu, which keeps its times. Quickest: on Strava, open their race, then ⋯ → Export GPX. Strava leaves out the times, so add the results too and Lactic pins it to their lap times. No power or heart rate needed.</p>
        {rivals.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {rivals.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted"> · {r.points.toLocaleString()} points{r.timed ? ", with times" : ", no times in the file"}</span>
                  {!r.timed && <span className="block text-xs text-muted">For exact section times, ask them for their original file (Garmin, Wahoo, Hammerhead or intervals.icu export) and add it in place of this one.</span>}
                </span>
                <button type="button" className={button.ghost} disabled={pending} onClick={() => run(() => deleteRival(r.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {rows.length ? (
            <Select className={input} value={rivalName} onChange={(v) => setRivalName(v)} aria-label="Whose file it is">
              <option value="">Whose file?</option>
              {rows
                .filter((r) => r.name !== me)
                .map((r) => (
                  <option key={r.place} value={r.name}>
                    {r.place}. {r.name}
                  </option>
                ))}
            </Select>
          ) : (
            <input className={input} placeholder="Their name" value={rivalName} onChange={(e) => setRivalName(e.target.value)} aria-label="Their name" />
          )}
          <input type="file" accept=".gpx,.fit" className={fileInput} aria-label="Their GPX file" onChange={(e) => setRivalFile(e.target.files?.[0] ?? null)} />
          <button
            type="button"
            className={button.primary}
            disabled={pending || !rivalFile}
            onClick={() =>
              rivalFile &&
              run(async () => {
                const r = await uploadRival(activityId, rivalName, rivalFile.name, await readFile(rivalFile, "base64"));
                if (r.ok) {
                  setRivalFile(null);
                  setRivalName("");
                }
                return r;
              })
            }
          >
            Add rider
          </button>
        </div>
      </Step>
      {message && <Result ok={message.ok}>{message.text}</Result>}
    </div>
  );
}
