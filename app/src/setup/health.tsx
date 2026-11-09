// Apple Health setup: where the iPhone drops its files, how to get it sending, and what came in.

import { useEffect, useState } from "react";
import { button, Pill, Result, Segmented } from "@/components/ui";
import { healthFolder, importHealthFolder, setHealthFolder, SOURCE_SETTING } from "~/integrations/apple-health";
import { isDesktop, openExternal, os } from "~/platform/native";
import { getSetting, setSetting } from "~/settings/store";

type Source = "apple" | "watch" | "android";

/** Step-by-step build of the Shortcut that saves Apple Health to the folder. */
const SHORTCUT_GUIDE = "https://github.com/blairj09/lactic/blob/main/docs/apple-health-shortcut.md";

interface LastImport {
  at: string;
  nights: number;
  days: number;
  latest: string | null;
  failed: string[];
}

export function HealthSetup({ heading = true }: { heading?: boolean }) {
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
    setResult(r ?? { ok: true, message: "No new files yet. They arrive after your iPhone sends them." });
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
      ? "Turn on iCloud Drive on this Mac (System Settings → your name → iCloud), or choose another folder your iPhone syncs to."
      : os() === "windows"
        ? "Install iCloud for Windows and turn on iCloud Drive, or choose another folder your iPhone syncs to (Dropbox, Google Drive)."
        : "Choose a folder your iPhone syncs to, such as Dropbox, Nextcloud or Syncthing.";
  const receiving = Boolean(last && (last.nights > 0 || last.days > 0));
  const [source, setSource] = useState<Source>(() => (os() === "macos" ? "apple" : "watch"));
  useEffect(() => {
    if (receiving) setSource("apple");
    else void getSetting<Source | null>(SOURCE_SETTING, null).then((s) => s && setSource(s));
  }, [receiving]);
  // Saved so Today can name the source ("Connect Apple Health") instead of a general line.
  const pick = (s: Source) => {
    setSource(s);
    void setSetting(SOURCE_SETTING, s);
  };
  const link = (href: string, text: string) => (
    <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal(href)}>
      {text}
    </button>
  );

  return (
    <div className={heading ? "space-y-3 rounded-lg border border-line p-4" : "space-y-3"}>
      <div className={heading || receiving ? "flex items-center justify-between gap-3" : "hidden"}>
        <div className={heading ? undefined : "hidden"}>
          <p className="font-medium">Sleep and recovery</p>
          <p className="text-sm text-muted">Sleep, HRV and resting heart rate for a daily recovery score.</p>
        </div>
        {receiving && <Pill tone="positive">Receiving</Pill>}
      </div>
      <Segmented
        label="Where your sleep is recorded"
        value={source}
        onChange={pick}
        options={[
          { value: "apple", label: "Apple Watch" },
          { value: "watch", label: "Garmin, Oura, WHOOP" },
          { value: "android", label: "Android" },
        ]}
      />
      {source === "watch" ? (
        <p className="text-sm text-muted">Link your watch or ring to intervals.icu, then connect intervals.icu above. Works with Garmin, Oura, WHOOP, Polar, Coros and Suunto.</p>
      ) : source === "android" ? (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>On your phone, install {link("https://play.google.com/store/apps/details?id=nl.appyhapps.healthsync", "Health Sync")}.</li>
            <li>Sync Health Connect (or Samsung Health) to intervals.icu, with sleep, heart rate and weight on.</li>
            <li>Connect intervals.icu above.</li>
          </ol>
          <p className="text-sm text-faint">Samsung doesn&apos;t share HRV, so Galaxy Watch recovery uses sleep and resting heart rate.</p>
        </>
      ) : !isDesktop ? (
        <p className="text-sm text-muted">Needs the Lactic desktop app.</p>
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
              On your iPhone, build the free {link(SHORTCUT_GUIDE, "Lactic Shortcut")} (about 10 minutes, once), or install{" "}
              {link("https://www.healthyapps.dev", "Health Auto Export")}.
            </li>
            <li>
              Have it save to <span className="text-ink">{shortFolder ?? "iCloud Drive/Lactic"}</span> each morning. Lactic picks it up from there.
            </li>
          </ol>
          <div className="flex flex-wrap items-center gap-3">
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
  );
}
