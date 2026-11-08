// Settings → About: the version, whether a newer one is out, and a button to check now.

import { useEffect, useState } from "react";
import { button } from "@/components/ui";
import { isDesktop, openExternal } from "~/platform/native";
import { isBeta } from "~/app/beta";
import { checkForUpdate, installUpdate, releaseUrl, updatesSupported, useUpdates } from "./updates";

/** Lactic's Ko-fi page: one-off or monthly tips, no account needed to give. */
const SUPPORT_URL = "https://ko-fi.com/lactic";

export function AboutSetting() {
  const state = useUpdates();
  const [version, setVersion] = useState<string | null>(null);
  // The version the updater compares (tauri.conf.json); "dev" in a browser.
  useEffect(() => {
    if (!isDesktop) return setVersion("dev");
    void import("@tauri-apps/api/app").then((app) => app.getVersion()).then(setVersion);
  }, []);
  const busy = state.status === "checking" || state.status === "installing" || state.status === "restarting";
  return (
    <div className="space-y-4 text-sm sm:col-span-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
        <dt className="text-muted">Version</dt>
        <dd className="num">{version ?? "…"}{isBeta && " (beta)"}</dd>
        {updatesSupported && (
          <>
            <dt className="text-muted">Updates</dt>
            <dd role="status">{status(state)}</dd>
          </>
        )}
      </dl>
      {updatesSupported && (
        <div className="flex flex-wrap items-center gap-2">
          {state.status === "available" ? (
            <>
              <button type="button" className={button.smallPrimary} onClick={() => void installUpdate()}>
                Update and restart
              </button>
              <button type="button" className={button.small} onClick={() => void openExternal(releaseUrl(state.version))}>
                What&apos;s new
              </button>
            </>
          ) : (
            <button type="button" className={button.small} disabled={busy} onClick={() => void checkForUpdate()}>
              {state.status === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
        </div>
      )}
      <p className="text-muted">
        Lactic is free and open source.{" "}
        <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal("https://lactic.fit")}>
          lactic.fit
        </button>
      </p>
      <p className="text-muted">
        Enjoying it? Chip in to keep it going.{" "}
        <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal(SUPPORT_URL)}>
          Support Lactic
        </button>
      </p>
    </div>
  );
}

function status(state: ReturnType<typeof useUpdates>): React.ReactNode {
  switch (state.status) {
    case "available":
      return <span className="font-medium">Lactic {state.version} is available</span>;
    case "installing":
      return "Downloading the update…";
    case "restarting":
      return "Restarting…";
    case "checking":
      return "Checking…";
    case "current":
      return "Up to date";
    case "error":
      return <span className="text-negative">{state.message}</span>;
    default:
      return "Checked each time Lactic starts";
  }
}
