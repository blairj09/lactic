// Apple Health setup: where the iPhone drops its files, how to get it sending, and what came in.

import { useEffect, useState } from "react";
import { button, Pill, Result } from "@/components/ui";
import { healthFolder, importHealthFolder } from "~/integrations/apple-health";
import { isDesktop, openExternal } from "~/platform/native";
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

  const shortFolder = folder?.replace(/^.*com~apple~CloudDocs/, "iCloud Drive");
  return (
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
        <p className="text-sm text-muted">Turn on iCloud Drive on this Mac (System Settings → your name → iCloud) so your iPhone can hand Lactic its Health data.</p>
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
            {last && <span className="text-sm text-faint">Last import {new Date(last.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{last.latest ? ` · ${last.latest}` : ""}</span>}
          </div>
          {result && <Result ok={result.ok}>{result.message}</Result>}
        </>
      )}
    </div>
  );
}
