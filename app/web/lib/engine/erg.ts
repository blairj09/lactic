import { ramp, steady, type Segment, type Workout } from "./workout";
import { parseZwo } from "./zwo";

/**
 * Reads an .erg (watts) or .mrc (percent of FTP) workout file, the plain-text format TrainerRoad,
 * Golden Cheetah, PerfPRO and many apps share. Each row is minutes and a target; a row at the same
 * minute as the one before is a step, a later one a ramp from it. Watts become a share of the file's
 * FTP line, else of `ftp` (the rider's).
 */
export function parseErgMrc(text: string, fileName: string, ftp: number): Workout {
  const header = text.match(/\[COURSE HEADER\]([\s\S]*?)\[END COURSE HEADER\]/i)?.[1] ?? "";
  const data = text.match(/\[COURSE DATA\]([\s\S]*?)\[END COURSE DATA\]/i)?.[1];
  if (data === undefined) throw new Error("No [COURSE DATA] section");
  const line = (key: string) => header.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "im"))?.[1];
  const percent = /MINUTES\s+PERCENT/i.test(header) || (!/MINUTES\s+WATTS/i.test(header) && /\.mrc$/i.test(fileName));
  const fileFtp = Number(line("FTP"));
  const base = Number.isFinite(fileFtp) && fileFtp > 0 ? fileFtp : ftp;
  if (!percent && !(base > 0)) throw new Error("This file is in watts and there's no FTP to scale it by");
  const share = (value: number) => Math.round((percent ? value / 100 : value / base) * 1000) / 1000;

  const points: [number, number][] = [];
  for (const row of data.split(/\r?\n/)) {
    const [minutes, value] = row.trim().split(/\s+/).map(Number);
    if (Number.isFinite(minutes) && Number.isFinite(value)) points.push([minutes * 60, share(value)]);
  }
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [t0, from] = points[i];
    const [t1, to] = points[i + 1];
    const seconds = Math.round(t1 - t0);
    if (seconds <= 0) continue;
    segments.push(from === to ? steady(seconds, from) : ramp(seconds, from, to));
  }
  if (segments.length === 0) throw new Error("Workout has no segments");
  const name = line("DESCRIPTION") || line("FILE NAME")?.replace(/\.(erg|mrc)$/i, "") || fileName.replace(/\.(erg|mrc)$/i, "") || "Untitled workout";
  return { name, segments };
}

/** A workout from an imported file: .zwo, .erg or .mrc. */
export function workoutFromFile(text: string, fileName: string, ftp: number): Workout {
  if (/\[COURSE HEADER\]|\[COURSE DATA\]/i.test(text)) return parseErgMrc(text, fileName, ftp);
  return parseZwo(text);
}
