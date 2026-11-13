// Lactic Modular and development builds only: run the plugin sandbox self-check (src/plugins/
// selfcheck.ts) inside this app's own webview, so the escape tests can be tried on a real Mac build.

import { useState } from "react";
import { button, Result } from "@/components/ui";
import type { Check } from "~/plugins/selfcheck";

export function SandboxCheck() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failed = checks?.filter((c) => !c.pass) ?? [];

  async function run() {
    setRunning(true);
    setChecks(null);
    setError(null);
    setDone(0);
    try {
      const { runSandboxCheck } = await import("~/plugins/selfcheck");
      setChecks(await runSandboxCheck(setDone));
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function copy() {
    if (!checks) return;
    const text = checks.map((c) => `${c.pass ? "pass" : "FAIL"}  ${c.name}: ${c.detail}`).join("\n");
    await navigator.clipboard.writeText(`Lactic plugin sandbox check (${navigator.userAgent})\n${text}`);
  }

  return (
    <div className="space-y-3 text-sm sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={button.secondary} onClick={run} disabled={running}>
          {running ? `Running… ${done}` : "Run sandbox check"}
        </button>
        {checks && (
          <button type="button" className={button.ghost} onClick={copy}>
            Copy results
          </button>
        )}
      </div>
      {error && <Result ok={false}>{error}</Result>}
      {checks && (
        <>
          <Result ok={failed.length === 0}>{failed.length === 0 ? `All ${checks.length} checks passed.` : `${failed.length} of ${checks.length} checks failed.`}</Result>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span className={c.pass ? "text-muted" : "font-medium text-negative"}>{c.pass ? "✓" : "✗"}</span>
                <span>
                  <span className="text-ink">{c.name}</span> <span className="text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
