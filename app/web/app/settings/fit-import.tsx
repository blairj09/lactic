"use client";

import { fileInput } from "@/components/ui";
import { useState } from "react";
import { gunzipSync, unzipSync } from "fflate";
import { decodeFit, FIT_SPORT_CYCLING } from "@/lib/fit/decode";
import { rideFromFit, type ImportedRide } from "@/lib/fit/ride";
import { importRides } from "../actions";

const BATCH = 25;

export default function FitImport() {
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  const run = async (files: File[]) => {
    setBusy(true);
    const log: string[] = [];
    const note = (line: string) => {
      log.push(line);
      setLines([...log]);
    };
    const rides: ImportedRide[] = [];
    let skipped = 0;
    let failed = 0;
    for (const file of files) {
      let entries: FitEntry[];
      try {
        entries = await readFitFiles(file);
      } catch (e) {
        note(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const archive = /\.zip$/i.test(file.name);
      if (archive && !entries.length) note(`${file.name}: no .fit files inside.`);
      for (const entry of entries) {
        try {
          const fit = decodeFit(entry.gzipped ? gunzipSync(entry.bytes) : entry.bytes);
          if (fit.sport !== undefined && fit.sport !== FIT_SPORT_CYCLING) {
            skipped++;
            continue;
          }
          rides.push(rideFromFit(fit, entry.name.replace(/\.gz$/i, "")));
        } catch (e) {
          // One bad file in a big archive is noted as a count, not a line each.
          if (archive) failed++;
          else note(`${entry.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    if (skipped) note(`Skipped ${skipped} file${skipped === 1 ? "" : "s"} that aren't rides.`);
    if (failed) note(`${failed} file${failed === 1 ? "" : "s"} in the archive couldn't be read.`);
    for (let i = 0; i < rides.length; i += BATCH) {
      const result = await importRides(rides.slice(i, i + BATCH));
      note(result.message);
      if (!result.ok) break;
    }
    if (!rides.length && !log.length) note("No rides found in those files.");
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <input
        type="file"
        multiple
        accept=".fit,.gz,.zip"
        disabled={busy}
        className={fileInput}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void run(files);
        }}
      />
      {busy && <p className="text-sm text-muted">Importing...</p>}
      {lines.length > 0 && (
        <ul className="space-y-0.5 text-sm text-muted">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One FIT file to read; ones from inside a zip are unpacked as they're read. */
interface FitEntry {
  name: string;
  bytes: Uint8Array;
  gzipped?: boolean;
}

/**
 * The FIT files in what was picked: the file itself, or every .fit and .fit.gz inside a .zip (Strava's
 * archive keeps rides as activities/123.fit.gz; Garmin's nests zips of .fit files).
 */
async function readFitFiles(file: File): Promise<FitEntry[]> {
  if (!/\.zip$/i.test(file.name)) return [{ name: file.name, bytes: await readBytes(file) }];
  return fitsInZip(new Uint8Array(await file.arrayBuffer()));
}

function fitsInZip(zip: Uint8Array, depth = 0): FitEntry[] {
  const wanted = (name: string) => /\.(fit|fit\.gz)$/i.test(name) || (depth < 2 && /\.zip$/i.test(name));
  const files = unzipSync(zip, { filter: (f) => wanted(f.name) });
  return Object.entries(files).flatMap(([path, bytes]) => {
    const name = path.split("/").pop() ?? path;
    if (/\.zip$/i.test(name)) return fitsInZip(bytes, depth + 1);
    return [{ name, bytes, gzipped: /\.gz$/i.test(name) }];
  });
}

async function readBytes(file: File): Promise<Uint8Array> {
  if (!file.name.toLowerCase().endsWith(".gz")) return new Uint8Array(await file.arrayBuffer());
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
