// A short "Plan updated · Undo" after a Coach Apply, so a change the rider didn't mean can be taken
// back at once. Everything else is undone from Settings → Your data → App history.

import { useEffect, useState } from "react";
import { HISTORY_EVENT } from "./changes";
import { afterUndo } from "./refresh";
import { entryChanges, undoEntry } from "./store";

const SHOW_MS = 10_000;

export function UndoToast() {
  const [shown, setShown] = useState<{ id: string; title: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const saved = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; title: string; toast: boolean }>).detail;
      // Undone some other way (App history): nothing left to offer.
      if (!d?.toast) return setShown((s) => (s && d?.id === s.id ? null : s));
      setNote(null);
      setShown({ id: d.id, title: d.title });
    };
    window.addEventListener(HISTORY_EVENT, saved);
    return () => window.removeEventListener(HISTORY_EVENT, saved);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), note ? 4000 : SHOW_MS);
    return () => clearTimeout(timer);
  }, [shown, note]);

  if (!shown) return null;

  async function undo(id: string) {
    try {
      const tables = (await entryChanges(id)).map((c) => c.table);
      await undoEntry(id);
      await afterUndo(tables);
      setNote("Undone.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div role="status" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-1/2 z-40 sm:bottom-4 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-lg bg-primary px-4 py-2.5 text-sm text-on-primary shadow-xl">
      <span className="min-w-0 truncate">{note ?? shown.title}</span>
      {!note && (
        <button type="button" className="shrink-0 font-semibold underline underline-offset-4" onClick={() => void undo(shown.id)}>
          Undo
        </button>
      )}
    </div>
  );
}
