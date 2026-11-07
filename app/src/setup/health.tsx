// Apple Health setup: where the iPhone drops its files, how to get it sending, and what came in.

import { useEffect, useState } from "react";
import { button, Pill, Result } from "@/components/ui";
import { healthFolder, importHealthFolder, setHealthFolder } from "~/integrations/apple-health";
import { isDesktop, openExternal, os } from "~/platform/native";
import { getSetting } from "~/settings/store";

interface LastImport {
  at: string;
  nights: number;
  days: number;
  latest: string | null;
  failed: string[];
}

export function HealthSetup() {
  const [folder, setFolder] = useState<string | null | undefined>(undefined);
  const [last, setLast] = useState<LastImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void healthFolder()
      .then(setFolder)
      .catch(() => setFolder(null));
    void getSetting<LastImport | null>("health.lastImport", null).then(setLast);
  }, []);

  async function importNow() {
    setBusy(true);
    setResult(null);
    const r = await importHealthFolder().catch((e) => ({ ok: false, message: String(e) }));
    setResult(r ?? { ok: true, message: "No new files yet. They arrive after the Shortcut runs on your iPhone." });
    setLast(await getSetting<LastImport | null>("health.lastImport", null));
    setBusy(false);
  }

  async function chooseFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, title: "Folder your phone saves Health files to" });
    if (typeof picked !== "string") return;
    await setHealthFolder(picked);
    setFolder(await healthFolder().catch(() => null));
  }

  const shortFolder = folder?.replace(/^.*com~apple~CloudDocs/, "iCloud Drive").replace(/^.*[\\/]iCloudDrive/, "iCloud Drive");
  const noCloud =
    os() === "macos"
      ? "Turn on iCloud Drive on this Mac (System Settings → your name → iCloud) so your iPhone can hand Lactic its Health data, or choose another folder that syncs from your phone."
      : os() === "windows"
        ? "Install iCloud for Windows and turn on iCloud Drive so your iPhone can hand Lactic its Health data, or choose another folder that syncs from your phone (Dropbox, Google Drive)."
        : "Choose a folder that syncs from your phone, such as Dropbox, Nextcloud or Syncthing. Your iPhone saves its Health data there and Lactic picks it up.";
  return (
    <>
      <div className="space-y-1 rounded-lg border border-line p-4">
        <p className="font-medium">Garmin, Oura, WHOOP, Polar, Coros, Suunto</p>
        <p className="text-sm text-muted">
          Link your watch or ring to intervals.icu and connect intervals.icu here. Lactic reads the sleep, HRV, resting heart rate and weight it collects. On Android,
          this is the way in for most watches.
        </p>
      </div>
      <div className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Apple Health</p>
          <p className="text-sm text-muted">Sleep, HRV and resting heart rate from your Apple Watch (or any app that writes to Health) for the morning recovery score.</p>
        </div>
        {last && (last.nights > 0 || last.days > 0) && <Pill tone="positive">Receiving</Pill>}
      </div>
      {!isDesktop ? (
        <p className="text-sm text-muted">Needs the Lactic desktop app and iCloud Drive.</p>
      ) : folder === null ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">{noCloud}</p>
          <button type="button" className={button.small} onClick={() => void chooseFolder()}>
            Choose folder…
          </button>
        </div>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              On your iPhone, install{" "}
              <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal("https://www.healthyapps.dev")}>
                Health Auto Export
              </button>{" "}
              (or the Lactic Shortcut) and set it to save JSON to <span className="text-ink">{shortFolder ?? "iCloud Drive/Lactic"}</span> each morning.
            </li>
            <li>Lactic picks up each file when it arrives and files it under Imported.</li>
          </ol>
          <div className="flex items-center gap-3">
            <button type="button" className={button.small} disabled={busy} onClick={() => void importNow()}>
              {busy ? "Looking…" : "Check now"}
            </button>
            <button type="button" className={button.ghost} onClick={() => void chooseFolder()}>
              Change folder
            </button>
            {last && <span className="text-sm text-faint">Last import {new Date(last.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{last.latest ? ` · ${last.latest}` : ""}</span>}
          </div>
          {result && <Result ok={result.ok}>{result.message}</Result>}
        </>
      )}
      </div>
    </>
  );
}
