// Your rides so far: connect intervals.icu (which most apps, Zwift and Garmin included, already
// sync to) or drop in FIT files. History gives the engine your fitness from day one.

import { useEffect, useState } from "react";
import FitImport from "@/app/settings/fit-import";
import { button, input, Pill, Result } from "@/components/ui";
import { connect, loadConnection } from "@/lib/intervals/client";
import { LOCAL_USER } from "~/db/schema";
import { createClient } from "~/db/supabase-client";
import { openExternal } from "~/platform/native";
import { placeholder, saveSecret } from "~/platform/secrets";
import { notifyChanged } from "~/integrations/background";
import { HealthSetup } from "./health";

export const SECRET_INTERVALS = "intervals";

export function useIntervalsConnected() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void loadConnection(createClient()).then((c) => setOn(Boolean(c)), () => setOn(false));
  }, []);
  return [on, setOn] as const;
}

export function IntervalsConnect({ onConnected, heading = true }: { onConnected?: () => void; heading?: boolean }) {
  const [connected, setConnected] = useIntervalsConnected();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const k = key.trim();
    if (!/^[A-Za-z0-9]{10,100}$/.test(k)) return setError("That doesn't look like an intervals.icu API key.");
    setBusy(true);
    setError(null);
    try {
      await saveSecret(SECRET_INTERVALS, k);
      await connect(createClient(), LOCAL_USER, placeholder(SECRET_INTERVALS));
      setConnected(true);
      setKey("");
      notifyChanged("intervals");
      onConnected?.();
    } catch (e) {
      setError(e instanceof Error && /401|403/.test(e.message) ? "intervals.icu turned that key down. Check you copied all of it." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={heading ? "space-y-3 rounded-lg border border-line p-4" : "space-y-3"}>
      <div className={heading || connected ? "flex items-center justify-between gap-3" : "hidden"}>
        <div className={heading ? undefined : "hidden"}>
          <p className="font-medium">intervals.icu</p>
          <p className="text-sm text-muted">Free. Zwift, Garmin, Wahoo and most apps sync to it, so one key brings in your rides.</p>
        </div>
        {connected && <Pill tone="positive">Connected</Pill>}
      </div>
      {connected ? (
        <p className="text-sm text-muted">Importing your history. New rides come in on their own, and Lactic rides go back to intervals.icu.</p>
      ) : (
        <>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Open{" "}
              <button type="button" className="text-ink underline underline-offset-4" onClick={() => void openExternal("https://intervals.icu/settings")}>
                intervals.icu settings
              </button>{" "}
              (sign up free if you need to).
            </li>
            <li>Under Developer Settings, copy your API key.</li>
            <li>Paste it here. It stays in your keychain.</li>
          </ol>
          <div className="flex gap-2">
            <input className={`${input} min-w-0 flex-1`} type="password" placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
            <button type="button" className={button.primary} disabled={busy || !key.trim()} onClick={() => void go()}>
              {busy ? "Checking…" : "Connect"}
            </button>
          </div>
          {error && <Result ok={false}>{error}</Result>}
        </>
      )}
    </div>
  );
}

export function RidesSetup({ sleep = true }: { sleep?: boolean }) {
  return (
    <div className="space-y-4">
      <IntervalsConnect />
      <div className="space-y-3 rounded-lg border border-line p-4">
        <div>
          <p className="font-medium">FIT files</p>
          <p className="text-sm text-muted">Or import files from Garmin Connect, Wahoo or Zwift (Documents/Zwift/Activities).</p>
        </div>
        <FitImport />
      </div>
      {sleep && <HealthSetup />}
      <p className="text-sm text-muted">No history? Lactic starts from your FTP and learns as you ride.</p>
    </div>
  );
}
