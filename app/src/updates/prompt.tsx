// The update cards, bottom left of every page. "Lactic X is available" lists what's new, with
// Update and restart; it's hidden on the Ride screen so nobody restarts mid-workout. After the
// restart, "Updated to X" lists the same changes once. A check from the Mac menu that finds nothing
// says so here too.

import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { button, Result } from "@/components/ui";
import { openExternal } from "~/platform/native";
import { dismiss, dismissedVersion, dismissInstalled, installUpdate, justInstalled, releaseUrl, startUpdateChecks, useUpdates } from "./updates";

const SHOWN = 5;

export function UpdatePrompt() {
  const state = useUpdates();
  const { pathname } = useLocation();
  useEffect(() => startUpdateChecks(), []);
  const onRide = pathname.startsWith("/ride");

  if ((state.status === "current" || state.status === "error") && state.announce && !("version" in state && state.version)) {
    return (
      <Card label="Lactic update" title={state.status === "current" ? "You're up to date" : "Couldn't check for updates"}>
        <p className="text-sm text-muted">{state.status === "current" ? "You have the latest version of Lactic." : state.message}</p>
        <div className="flex">
          <button type="button" className={button.small} onClick={dismiss}>
            OK
          </button>
        </div>
      </Card>
    );
  }

  const version = "version" in state ? state.version : undefined;
  const waiting = state.status === "available" || state.status === "error";
  const installed = justInstalled();
  if (!version || (waiting && (dismissedVersion() === version || onRide))) {
    if (!installed || onRide) return null;
    return (
      <Card label="Lactic updated" title={`Updated to Lactic ${installed.version}`}>
        <WhatsNew version={installed.version} notes={installed.notes} />
        <div className="flex">
          <button type="button" className={button.small} onClick={() => void dismissInstalled()}>
            Got it
          </button>
        </div>
      </Card>
    );
  }

  const notes = "notes" in state ? (state.notes ?? []) : [];
  return (
    <Card label="Lactic update" title={`Lactic ${version} is available`}>
      {state.status === "installing" || state.status === "restarting" ? (
        <p className="text-sm text-muted">{state.status === "installing" ? `Downloading… ${progress(state.downloaded, state.total)}` : "Installed. Restarting…"}</p>
      ) : (
        <WhatsNew version={version} notes={notes} />
      )}
      {state.status === "error" && <Result ok={false}>{state.message}</Result>}
      {waiting && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button.smallPrimary} onClick={() => void installUpdate()}>
            {state.status === "error" ? "Try again" : "Update and restart"}
          </button>
          <button type="button" className={button.small} onClick={dismiss}>
            Later
          </button>
        </div>
      )}
    </Card>
  );
}

function Card({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <aside className="fixed bottom-4 left-4 z-30 w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-line bg-surface p-4 shadow-xl" aria-label={label}>
      <p className="text-sm font-semibold">{title}</p>
      {children}
    </aside>
  );
}

/** The release's changes, the first few with the rest behind "more", and the full notes on GitHub. */
function WhatsNew({ version, notes }: { version: string; notes: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? notes : notes.slice(0, SHOWN);
  const link = (
    <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal(releaseUrl(version))}>
      Release notes
    </button>
  );
  if (!notes.length) return <p className="text-sm text-muted">See what&apos;s new in the {link}. Lactic restarts to finish; your data stays as it is.</p>;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted">What&apos;s new</p>
      <ul className="max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
        {shown.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      <p className="text-muted">
        {notes.length > SHOWN && !all && (
          <>
            <button type="button" className="text-ink underline underline-offset-4" onClick={() => setAll(true)}>
              {notes.length - SHOWN} more
            </button>
            {" · "}
          </>
        )}
        {link}
      </p>
    </div>
  );
}

function progress(done: number, total?: number): string {
  return total ? `${Math.min(100, Math.round((done / total) * 100))}%` : `${(done / 1_000_000).toFixed(0)} MB`;
}
