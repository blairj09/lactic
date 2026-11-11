// "Bring your training": where a rider's rides are now, best way first, and what they've told
// Lactic so far. Setup's first step, and the sheet behind every "Bring my rides" button.

import { useEffect, useState } from "react";
import FitImport, { ImportLog, useRideImport } from "@/app/settings/fit-import";
import { button, fileInput, Pill } from "@/components/ui";
import { isDesktop, isPhone, openExternal, os } from "~/platform/native";
import { revalidatePath } from "~/shims/next-cache";
import { IntervalsConnect } from "./rides";
import { fileAt, historySoFar, STRAVA_DOWNLOAD, stravaArchiveInDownloads, ZWIFT_FOLDER, zwiftRideFiles, type HistorySoFar } from "./history";

const card = "space-y-3 rounded-lg border border-line bg-surface p-4";

/** Zwift files are read and imported this many at a time. */
const ZWIFT_BATCH = 40;

function ZwiftRides() {
  const [files, setFiles] = useState<Awaited<ReturnType<typeof zwiftRideFiles>>>([]);
  const [done, setDone] = useState<number | null>(null);
  const { busy, lines, run } = useRideImport();
  useEffect(() => {
    void zwiftRideFiles().then(setFiles);
  }, []);
  if (!files.length) return null;

  async function go() {
    setDone(0);
    for (let i = 0; i < files.length; i += ZWIFT_BATCH) {
      const batch = await Promise.all(files.slice(i, i + ZWIFT_BATCH).map(fileAt));
      await run(batch);
      setDone(Math.min(files.length, i + ZWIFT_BATCH));
    }
  }

  const working = busy || (done !== null && done < files.length);
  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Zwift on this {os() === "macos" ? "Mac" : "computer"} <Pill>Found {files.length} ride{files.length === 1 ? "" : "s"}</Pill>
          </p>
          <p className="text-sm text-muted">From {ZWIFT_FOLDER.replace("~/", "")}. No account needed.</p>
        </div>
        {done === files.length && !busy ? (
          <Pill tone="positive">Imported</Pill>
        ) : (
          <button type="button" className={button.secondary} disabled={working} onClick={() => void go()}>
            {working ? `${done ?? 0} of ${files.length}…` : "Import"}
          </button>
        )}
      </div>
      {done === files.length && !busy && <ImportLog lines={lines} />}
    </div>
  );
}

function StravaArchive() {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Awaited<ReturnType<typeof stravaArchiveInDownloads>>>(null);
  const [reading, setReading] = useState(false);
  const { busy, lines, run } = useRideImport();
  const watching = open && isDesktop && !isPhone() && !lines.length;

  // While the steps are open, look in Downloads for the archive every few seconds.
  useEffect(() => {
    if (!watching) return;
    let stop = false;
    const look = () => void stravaArchiveInDownloads().then((e) => !stop && setFound(e));
    look();
    const timer = window.setInterval(look, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [watching]);

  async function importFound() {
    if (!found) return;
    setReading(true);
    try {
      await run([await fileAt(found)]);
    } finally {
      setReading(false);
    }
  }

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Strava</p>
          <p className="text-sm text-muted">Every ride you've ever posted, from Strava's own download. Lactic walks you through it.</p>
        </div>
        {!open && (
          <button type="button" className={button.secondary} onClick={() => setOpen(true)}>
            Get my archive
          </button>
        )}
      </div>
      {open && (
        <ol className="space-y-3 border-t border-line pt-3 text-sm">
          <li className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">1. Ask Strava for it</span>
              <button type="button" className={button.secondary} onClick={() => void openExternal(STRAVA_DOWNLOAD)}>
                Open Strava
              </button>
            </div>
            <p className="text-muted">
              On Strava's “Download or delete your account” page, press <span className="text-ink">Request your archive</span>. You don't delete anything.
            </p>
          </li>
          <li className="space-y-1">
            <span className="font-medium">2. Wait for Strava's email</span>
            <p className="text-muted">Usually a few minutes to a few hours. Carry on with setup, and come back to this in Settings → Import ride files.</p>
          </li>
          <li className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">3. Download it</span>
              {watching && !found && <Pill>Watching Downloads</Pill>}
            </div>
            {found && !lines.length ? (
              <div className="flex items-center justify-between gap-3 rounded-md bg-accent-soft px-3 py-2">
                <span className="min-w-0 break-all">Found {found.name} in Downloads.</span>
                <button type="button" className={button.smallPrimary} disabled={busy || reading} onClick={() => void importFound()}>
                  {busy || reading ? "Importing…" : "Import it"}
                </button>
              </div>
            ) : (
              <p className="text-muted">{isDesktop && !isPhone() ? "Lactic spots the export_….zip in your Downloads folder. Or choose the file:" : "Then choose the export_….zip here:"}</p>
            )}
            <input
              type="file"
              accept=".zip"
              disabled={busy || reading}
              className={fileInput}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void run(files);
              }}
            />
            {(busy || reading) && <p className="text-muted">Importing… a big archive can take a minute.</p>}
            <ImportLog lines={lines} />
          </li>
        </ol>
      )}
    </div>
  );
}

function monthYear(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

/** What the rides in so far give: how many, from when, and an FTP. Checks again every few seconds. */
export function HistoryCard() {
  const [h, setH] = useState<HistorySoFar | null>(null);
  useEffect(() => {
    let stop = false;
    const look = () =>
      void historySoFar().then(
        (x) => !stop && setH(x),
        () => {},
      );
    look();
    const timer = window.setInterval(look, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);
  if (!h || !h.rides) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">What Lactic already knows</p>
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
        <div className="bg-surface px-3 py-2.5">
          <p className="text-xs text-muted uppercase">Rides in</p>
          <p className="num text-xl font-semibold">{h.rides}</p>
        </div>
        <div className="bg-surface px-3 py-2.5">
          <p className="text-xs text-muted uppercase">Going back to</p>
          <p className="num text-xl font-semibold">{h.oldest ? monthYear(h.oldest) : "–"}</p>
        </div>
        <div className="bg-surface px-3 py-2.5">
          <p className="text-xs text-muted uppercase">FTP from rides</p>
          <p className="num text-xl font-semibold">{h.ftp ? `${h.ftp} W` : "–"}</p>
        </div>
      </div>
      <p className="text-sm text-muted">Carry on whenever you like. Older rides keep coming in the background, and your fitness and plan update as they land.</p>
    </div>
  );
}

/** Every way in for past rides, best first. */
export function RideSources() {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">Where are your rides now?</p>
      <div className="bg-surface rounded-lg">
        <IntervalsConnect best />
      </div>
      <ZwiftRides />
      <StravaArchive />
      <div className={card}>
        <div>
          <p className="font-medium">Garmin, Wahoo or a bike computer</p>
          <p className="text-sm text-muted">FIT, GPX or TCX files, or Garmin's whole account export.</p>
        </div>
        <FitImport />
      </div>
      <HistoryCard />
      <p className="text-sm text-muted">Riding for the first time? Skip this. Lactic starts from your FTP and learns as you ride.</p>
    </div>
  );
}

/** A button that opens every way in for past rides over the page. */
export function BringRidesButton({ label = "Bring my rides", className = button.primary }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    revalidatePath("/");
    revalidatePath("/progress");
  };
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16"
          onClick={(e) => e.target === e.currentTarget && close()}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="bring-rides-title" className="relative w-full max-w-xl space-y-4 rounded-xl border border-line bg-ground p-5 text-left text-ink shadow-2xl sm:p-6">
            <div>
              <h2 id="bring-rides-title" className="text-lg font-semibold">
                Bring your rides
              </h2>
              <p className="text-sm text-muted">Your past rides set your fitness, FTP and plan from where you are.</p>
            </div>
            <RideSources />
            <button type="button" className={button.secondary} onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
