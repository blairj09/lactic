"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { button as ui, Result } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { newSignInCode } from "../actions";

export type PasskeyRow = { id: string; name: string; createdAt: string; lastUsedAt: string | null };

/** Passkeys on this account, and one-time codes for signing in where a passkey can't (previews, a new device). */
export default function SignIn({ passkeys, passkeysHere, rpId }: { passkeys: PasskeyRow[] | null; passkeysHere: boolean; rpId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" });

  const run = async (work: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setResult(null);
    setResult(await work());
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="space-y-6 sm:col-span-2">
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Passkeys</h3>
        {!passkeysHere ? (
          <p className="text-sm text-muted">Passkeys are bound to {rpId}; add and manage them there.</p>
        ) : passkeys === null ? (
          <p className="text-sm text-muted">Couldn&apos;t load passkeys. Check Authentication &gt; Passkeys is on in Supabase.</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-muted">None yet. Add one here, then sign in with Touch ID or Face ID instead of email.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {p.name}
                  <span className="block text-muted">
                    Added {when(p.createdAt)}
                    {p.lastUsedAt ? `, last used ${when(p.lastUsedAt)}` : ", not used yet"}
                  </span>
                </span>
                <button
                  className={ui.small}
                  disabled={busy}
                  onClick={() => {
                    if (passkeys.length === 1 && !confirm("Remove your only passkey? You'll need a code or an email link to sign in.")) return;
                    run(async () => {
                      const { error } = await createClient().auth.passkey.delete({ passkeyId: p.id });
                      return error ? { ok: false, message: error.message } : { ok: true, message: "Passkey removed." };
                    });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {passkeysHere && passkeys !== null && (
          <button
            className={ui.secondary}
            disabled={busy}
            onClick={() =>
              run(async () => {
                const { error } = await createClient().auth.registerPasskey();
                if (!error) return { ok: true, message: "Passkey added. Next time, sign in with it." };
                if (error.code === "webauthn_credential_exists") return { ok: false, message: "This device's passkey is already added." };
                return { ok: false, message: /cancel|abort|NotAllowed/i.test(error.message) ? "Cancelled." : error.message };
              })
            }
          >
            Add a passkey on this device
          </button>
        )}
      </div>

      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-medium">Sign-in code</h3>
        <p className="text-sm text-muted">
          For a preview or a new device without a passkey. Each code works once, within the hour.
        </p>
        <button
          className={ui.secondary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            const r = await newSignInCode();
            setCode(r.code ?? null);
            setResult(r.ok ? null : r);
            setBusy(false);
          }}
        >
          Make a sign-in code
        </button>
        {code && (
          <p className="text-sm text-muted">
            <code className="num mr-2 inline-block rounded-md bg-raised px-3 py-2 text-lg tracking-widest text-ink select-all">{code}</code>
            Enter it on the sign-in page within the hour.
          </p>
        )}
      </div>
      <div className="space-y-3 border-t border-line pt-5">
        <h3 className="text-sm font-medium">Sign out</h3>
        <p className="text-sm text-muted">Signs out this browser only. Other devices stay signed in.</p>
        <button
          className={ui.secondary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            const { error } = await createClient().auth.signOut({ scope: "local" });
            if (error) {
              setResult({ ok: false, message: error.message });
              setBusy(false);
              return;
            }
            // A full load, so the middleware sees the cleared session cookie.
            window.location.assign("/login");
          }}
        >
          Sign out
        </button>
      </div>
      {result && <Result ok={result.ok}>{result.message}</Result>}
    </div>
  );
}
