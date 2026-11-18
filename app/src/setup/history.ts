// Where a new rider's past rides already sit on this computer (Zwift's activities folder, a Strava
// archive in Downloads), and what the rides brought in so far say about them.

import { loadRides } from "@/lib/activities";
import { estimateFtp } from "@/lib/engine/ftp";
import { mergeCurves } from "@/lib/engine/power";
import { createClient } from "~/db/supabase-client";
import { invoke, isDesktop, isPhone } from "~/platform/native";

interface Entry {
  name: string;
  path: string;
  modifiedMs: number;
  size: number;
  isDir: boolean;
}

/** Zwift saves every ride here, on a Mac and on Windows. */
export const ZWIFT_FOLDER = "~/Documents/Zwift/Activities";

/** Zwift's own file for the ride it's recording right now. */
const IN_PROGRESS = /^inprogress/i;

const list = (path: string) => (isDesktop && !isPhone() ? invoke<Entry[]>("folder_list", { path }).catch(() => [] as Entry[]) : Promise.resolve([] as Entry[]));

/** The finished rides in Zwift's folder on this computer, oldest first. */
export async function zwiftRideFiles(): Promise<Entry[]> {
  const entries = await list(ZWIFT_FOLDER);
  return entries.filter((e) => !e.isDir && /\.fit$/i.test(e.name) && !IN_PROGRESS.test(e.name) && e.size > 0).sort((a, b) => a.modifiedMs - b.modifiedMs);
}

/** Strava's account download as it lands in Downloads: export_<athlete id>.zip, newest first. */
export const STRAVA_ARCHIVE = /^export_\d+.*\.zip$/i;

/** The newest Strava archive in Downloads, if there is one. */
export async function stravaArchiveInDownloads(since = 0): Promise<Entry | null> {
  const entries = await list("~/Downloads");
  const archives = entries.filter((e) => !e.isDir && STRAVA_ARCHIVE.test(e.name) && e.modifiedMs >= since).sort((a, b) => b.modifiedMs - a.modifiedMs);
  return archives[0] ?? null;
}

/** A file on this computer as a File, for the same import as a picked one. */
export async function fileAt(entry: Entry): Promise<File> {
  const data = await invoke<string>("file_read_base64", { path: entry.path });
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new File([bytes], entry.name);
}

/** Where Strava's "Download your account" page is. */
export const STRAVA_DOWNLOAD = "https://www.strava.com/athlete/delete_your_account";

export interface HistorySoFar {
  rides: number;
  /** The oldest ride's start. */
  oldest: Date | null;
  /** FTP from the best efforts of the last 90 days, rounded to 5 W. */
  ftp: number | null;
}

const FTP_DAYS = 90;

/** What the rides in so far say: how many, from when, and an FTP from their best efforts. */
export async function historySoFar(): Promise<HistorySoFar> {
  const rides = (await loadRides(createClient())).filter((r) => !r.duplicateOf);
  const since = Date.now() - FTP_DAYS * 86_400_000;
  const curves = rides.filter((r) => r.powerCurve && r.startedAt.getTime() >= since).map((r) => r.powerCurve!);
  const estimate = curves.length ? estimateFtp(mergeCurves(...curves)) : null;
  const oldest = rides.reduce<Date | null>((o, r) => (!o || r.startedAt < o ? r.startedAt : o), null);
  return { rides: rides.length, oldest, ftp: estimate ? Math.round(estimate.watts / 5) * 5 : null };
}
