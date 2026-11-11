// Moving to a new computer: Restore from a backup (Settings → Your data, and the first screen of
// setup), and the card after a restore that says what to set up again on this computer.

import { useEffect, useRef, useState } from "react";
import { button, Result } from "@/components/ui";
import { dismissRestoredNotice, pickAndRestore, restoredNotice, type RestoredNotice } from "./restore";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Opens the restore dialog. `fresh` is setup on a new computer, with nothing here to replace. */
export function RestoreButton({ fresh = false, className = button.small, label = "Restore from a backup…" }: { fresh?: boolean; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <RestoreDialog fresh={fresh} onClose={() => setOpen(false)} />}
    </>
  );
}

function RestoreDialog({ fresh, onClose }: { fresh: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const done = await pickAndRestore();
      if (!done) return setBusy(false);
      // Start again on the restored data, with nothing from before held in memory.
      location.hash = "#/settings?section=data";
      location.reload();
    } catch (e) {
      setError(`Nothing was changed. ${message(e)}`);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="restore-title" className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-left text-sm text-ink shadow-2xl outline-none sm:p-6">
        <h2 id="restore-title" className="text-lg font-semibold">
          {fresh ? "Bring your data from another computer" : "Restore from a backup?"}
        </h2>
        <div className="space-y-1.5">
          <p className="font-medium">On your other computer</p>
          <p className="text-muted">
            Open Settings → Your data, choose Back up… and copy the .db file it saves to this computer. AirDrop, a USB stick or a cloud folder all work.
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">Everything comes across</p>
          <p className="text-muted">Rides, your plan, goals and events, workouts and favorites, recovery and weight, coach chats and memories, and your settings.</p>
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">You&apos;ll set these up again here</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted">
            <li>API keys for the coach and intervals.icu, since they stay in the other computer&apos;s keychain</li>
            <li>your Bluetooth gear: wake it and pair it once on this computer</li>
          </ul>
        </div>
        {!fresh && (
          <p className="rounded-md bg-raised px-3 py-2.5 text-muted">
            The backup replaces what&apos;s on this computer now. Lactic keeps a copy of today&apos;s data beside its database until your next restore.
          </p>
        )}
        {error && <Result ok={false}>{error}</Result>}
        <div className="flex justify-end gap-2">
          <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={button.primary} disabled={busy} onClick={() => void go()}>
            {busy ? "Restoring…" : "Pick the backup file…"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** After a restore: what came across and what's left to set up on this computer. */
export function RestoredCard() {
  const [notice, setNotice] = useState<RestoredNotice | null>(null);
  useEffect(() => {
    void restoredNotice().then(setNotice).catch(() => {});
  }, []);
  if (!notice) return null;
  const go = (section: string) => document.getElementById(section)?.scrollIntoView({ behavior: "smooth" });
  const todo: { text: string; section: string }[] = [];
  if (notice.keys.includes("ai")) todo.push({ text: "Add your AI key in Coach.", section: "coach-settings" });
  if (notice.keys.includes("intervals")) todo.push({ text: "Connect intervals.icu again with your API key.", section: "connections" });
  if (notice.mcp) todo.push({ text: "Connect your AI app to Lactic again from Coach.", section: "coach-settings" });
  if (notice.healthFolder) todo.push({ text: "Pick your Apple Health folder again in Sleep and recovery.", section: "health" });
  todo.push({ text: "Pair your trainer and sensors in Bluetooth.", section: "gear" });
  return (
    <div role="status" className="space-y-2 rounded-lg border border-accent/40 bg-raised px-4 py-3 sm:col-span-2">
      <p className="font-medium">Your backup is restored.</p>
      <p className="text-muted">To finish moving to this computer:</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {todo.map((t) => (
          <li key={t.text}>
            <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => go(t.section)}>
              {t.text}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={button.ghost}
        onClick={() => {
          setNotice(null);
          void dismissRestoredNotice();
        }}
      >
        Done
      </button>
    </div>
  );
}
