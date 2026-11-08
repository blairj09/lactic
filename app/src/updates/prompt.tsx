// The "new version" card, bottom left of every page. Hidden on the Ride screen so nobody restarts
// mid-workout; it comes back once the ride is over.

import { useEffect } from "react";
import { useLocation } from "react-router";
import { button, Result } from "@/components/ui";
import { openExternal } from "~/platform/native";
import { dismiss, dismissedVersion, installUpdate, releaseUrl, startUpdateChecks, useUpdates } from "./updates";

export function UpdatePrompt() {
  const state = useUpdates();
  const { pathname } = useLocation();
  useEffect(() => startUpdateChecks(), []);

  const version = "version" in state ? state.version : undefined;
  if (!version) return null;
  if ((state.status === "available" || state.status === "error") && dismissedVersion() === version) return null;
  if (state.status === "available" && pathname.startsWith("/ride")) return null;

  return (
    <aside className="fixed bottom-4 left-4 z-30 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-line bg-surface p-4 shadow-xl" aria-label="Lactic update">
      <div>
        <p className="text-sm font-semibold">Lactic {version} is available</p>
        <p className="text-sm text-muted">
          {state.status === "installing"
            ? `Downloading… ${progress(state.downloaded, state.total)}`
            : state.status === "restarting"
              ? "Installed. Restarting…"
              : "Lactic restarts to finish. Your data stays as it is."}
        </p>
      </div>
      {state.status === "error" && <Result ok={false}>{state.message}</Result>}
      {(state.status === "available" || state.status === "error") && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button.smallPrimary} onClick={() => void installUpdate()}>
            {state.status === "error" ? "Try again" : "Update and restart"}
          </button>
          <button type="button" className={button.small} onClick={dismiss}>
            Later
          </button>
          <button type="button" className="ml-auto text-sm text-muted underline-offset-4 hover:text-ink hover:underline" onClick={() => void openExternal(releaseUrl(version))}>
            What&apos;s new
          </button>
        </div>
      )}
    </aside>
  );
}

function progress(done: number, total?: number): string {
  const mb = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;
  return total ? `${Math.min(100, Math.round((done / total) * 100))}%` : mb(done);
}
