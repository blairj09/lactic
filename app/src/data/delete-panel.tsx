// Settings → Your data → Delete all my data: a dialog that says what goes and what stays, offers
// an export first, and needs the word "delete" typed before the red button works.

import { useEffect, useRef, useState } from "react";
import { button, input, Result } from "@/components/ui";
import { ExportEverythingButton } from "./export-buttons";
import { isDesktop, thisDevice } from "~/platform/native";
import { CONFIRM_WORD, deleteEverything } from "./delete";

export function DeleteDataButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${button.small} text-negative`} onClick={() => setOpen(true)}>
        Delete all my data…
      </button>
      {open && <DeleteDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toLowerCase() === CONFIRM_WORD && !busy;

  useEffect(() => {
    panel.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await deleteEverything();
      // The browser build saves its database a moment after each write.
      if (!isDesktop) await new Promise((r) => setTimeout(r, 600));
      // Start again at setup, with nothing held in memory.
      location.hash = "#/";
      location.reload();
    } catch (e) {
      setError(`Nothing was deleted: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="delete-title" className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-sm shadow-2xl outline-none sm:p-6">
        <h2 id="delete-title" className="text-lg font-semibold">Delete all your data?</h2>
        <div className="space-y-1.5">
          <p className="font-medium">This removes from {thisDevice()}, for good:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>every ride, your fitness history and FTP history</li>
            <li>your plan, goals, events and workouts</li>
            <li>sleep, recovery and weight</li>
            <li>coach chats and what the coach remembers</li>
            <li>your settings, paired gear and saved API keys</li>
          </ul>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">These stay:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>backups and exports you saved, and the files in your Apple Health folder</li>
            <li>rides and workouts already sent to intervals.icu, and feedback you sent</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-raised px-3 py-2.5">
          <span className="text-muted">Want a copy first?</span>
          <ExportEverythingButton />
        </div>
        <label className="block space-y-1.5">
          <span>
            Type <span className="font-semibold">{CONFIRM_WORD}</span> to confirm. Lactic then starts again at setup.
          </span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={`${input} w-full`} aria-label={`Type ${CONFIRM_WORD} to confirm`} />
        </label>
        {error && <Result ok={false}>{error}</Result>}
        <div className="flex justify-end gap-2">
          <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!ready} onClick={() => void go()} className="inline-flex h-9 items-center justify-center rounded-md bg-negative px-4 text-sm font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </div>
    </div>
  );
}
