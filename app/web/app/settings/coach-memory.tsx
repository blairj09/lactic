"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { button, input, Result } from "@/components/ui";
import type { MemoryFact } from "@/lib/coach/tools";
import { deleteFact, saveFact } from "../coach/actions";

/** What the coach remembers about you: facts it saved from your chats or you added. Shared by every conversation. */
export default function CoachMemory({ memory }: { memory: MemoryFact[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (work: () => Promise<{ ok: boolean; message: string }>, after?: () => void) =>
    start(async () => {
      const result = await work();
      setError(result.ok ? null : result.message);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-3 text-sm sm:col-span-2">
      {memory.length === 0 ? (
        <p className="text-muted">Nothing yet. The coach saves lasting facts you tell it (an injury, a preference, a constraint), and you can add your own.</p>
      ) : (
        <ul className="space-y-2">
          {memory.map((m) => (
            <Fact key={`${m.id}:${m.fact}`} fact={m} pending={pending} onSave={(text) => run(() => saveFact(m.id, text))} onDelete={() => run(() => deleteFact(m.id))} />
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveFact(null, draft), () => setDraft(""));
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} placeholder="e.g. Left knee gets sore above 3 hours" className={`${input} min-w-0 flex-1`} />
        <button className={button.secondary} disabled={pending || !draft.trim()}>
          Add
        </button>
      </form>
      {error && <Result ok={false}>{error}</Result>}
    </div>
  );
}

function Fact({ fact, pending, onSave, onDelete }: { fact: MemoryFact; pending: boolean; onSave: (text: string) => void; onDelete: () => void }) {
  const [text, setText] = useState(fact.fact);
  return (
    <li className="flex items-center gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} className={`${input} min-w-0 flex-1`} aria-label="Saved fact" />
      {text !== fact.fact && (
        <button className={button.secondary} disabled={pending || !text.trim()} onClick={() => onSave(text)}>
          Save
        </button>
      )}
      <button className={button.ghost} disabled={pending} onClick={onDelete}>
        Delete
      </button>
    </li>
  );
}
