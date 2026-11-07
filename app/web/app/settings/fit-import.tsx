"use client";

import { fileInput } from "@/components/ui";
import { useState } from "react";
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
    for (const file of files) {
      try {
        const fit = decodeFit(await readBytes(file));
        if (fit.sport !== undefined && fit.sport !== FIT_SPORT_CYCLING) {
          skipped++;
          continue;
        }
        rides.push(rideFromFit(fit, file.name.replace(/\.gz$/i, "")));
      } catch (e) {
        note(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (skipped) note(`Skipped ${skipped} file${skipped === 1 ? "" : "s"} that aren't rides.`);
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
        accept=".fit,.gz"
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

async function readBytes(file: File): Promise<Uint8Array> {
  if (!file.name.toLowerCase().endsWith(".gz")) return new Uint8Array(await file.arrayBuffer());
  const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
