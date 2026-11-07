// Changes an external AI coach proposed over MCP, waiting for the rider: a small stack in the
// corner of every page, each with Apply and Dismiss. Applying goes through the engine again.

import { useCallback, useEffect, useState } from "react";
import { applyChange } from "@/app/coach/actions";
import { button, Result } from "@/components/ui";
import type { Proposal } from "@/lib/coach/changes";
import { createClient } from "~/db/supabase-client";
import { revalidatePath } from "~/shims/next-cache";
import { PROPOSALS_CHANGED } from "./bridge";

interface Row {
  id: string;
  proposal: Proposal;
  created_at: string;
}

export function ExternalSuggestions() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().from("coach_proposals").select("id, proposal, created_at").eq("status", "pending").order("created_at", { ascending: true });
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(PROPOSALS_CHANGED, load);
    return () => window.removeEventListener(PROPOSALS_CHANGED, load);
  }, [load]);

  async function decide(row: Row, apply: boolean) {
    setBusy(row.id);
    setResult(null);
    const supabase = createClient();
    try {
      const message = apply ? await applyChange(supabase, row.proposal.change) : "Dismissed.";
      await supabase.from("coach_proposals").update({ status: apply ? "applied" : "dismissed" }).eq("id", row.id);
      setResult({ ok: true, message });
      revalidatePath("/");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      void load();
    }
  }

  if (!rows.length && !result) return null;
  return (
    <aside className="fixed right-4 bottom-4 z-30 w-[min(24rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-line bg-surface p-4 shadow-xl" aria-label="Suggestions from your AI coach">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">From your AI coach</p>
        {!rows.length && (
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setResult(null)} aria-label="Close">
            ×
          </button>
        )}
      </div>
      {rows.map((row) => (
        <div key={row.id} className="space-y-2 border-t border-line pt-3 first-of-type:border-0 first-of-type:pt-0">
          <p className="text-sm font-medium">{row.proposal.summary}</p>
          {row.proposal.reason && <p className="text-sm text-muted">{row.proposal.reason}</p>}
          <div className="flex gap-2">
            <button type="button" className={button.smallPrimary} disabled={busy !== null} onClick={() => void decide(row, true)}>
              {busy === row.id ? "Applying…" : "Apply"}
            </button>
            <button type="button" className={button.small} disabled={busy !== null} onClick={() => void decide(row, false)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </aside>
  );
}
