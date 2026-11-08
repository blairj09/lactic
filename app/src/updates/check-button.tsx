// Settings → Your data: the version, and a button to check for a newer one now.

import { button } from "@/components/ui";
import { checkForUpdate, installUpdate, updatesSupported, useUpdates } from "./updates";

export function CheckForUpdates() {
  const state = useUpdates();
  if (!updatesSupported) return null;
  const busy = state.status === "checking" || state.status === "installing" || state.status === "restarting";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {state.status === "available" ? (
        <button type="button" className={button.smallPrimary} onClick={() => void installUpdate()}>
          Update to {state.version} and restart
        </button>
      ) : (
        <button type="button" className={button.small} disabled={busy} onClick={() => void checkForUpdate()}>
          {state.status === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
      <span className="text-muted" role="status">
        {state.status === "current" && "You have the latest version."}
        {state.status === "installing" && "Downloading the update…"}
        {state.status === "restarting" && "Restarting…"}
        {state.status === "error" && <span className="text-negative">{state.message}</span>}
      </span>
    </div>
  );
}
