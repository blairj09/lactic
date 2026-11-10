// The iPhone's first screen: pair with Lactic on the computer, which brings everything across (the
// plan, rides, settings). Riders without a computer can set the phone up on its own instead.

import { useState } from "react";
import { MarkTile } from "~/app/brand";
import { button, Result } from "@/components/ui";
import { setSetting } from "~/settings/store";
import { phoneHealthName, phoneWord } from "~/platform/native";
import { PairWithComputer, useLinkState } from "./settings";

/** app_settings key: this phone was set up without a computer. */
export const SOLO = "phone.solo";

export function PhoneWelcome({ onSolo }: { onSolo: () => void }) {
  const [computer, setComputer] = useState<string | null>(null);
  const link = useLinkState();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <MarkTile size={56} />
      {computer ? (
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">Paired with {computer}</h1>
          {link?.error ? (
            <Result ok={false}>{link.error}</Result>
          ) : (
            <p className="text-muted">
              Bringing your plan, rides and settings across{link?.received ? ` (${link.received.toLocaleString()} so far)` : ""}. Keep Lactic open on both for a moment.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Pair with your computer</h1>
            <p className="text-muted">
              Your computer keeps your plan, rides and settings. Pair once and this {phoneWord()} syncs with it over Wi-Fi, reads {phoneHealthName()} for you, and runs rides with your trainer.
            </p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>On your computer, open Lactic → Settings → Phone.</li>
            <li>Click Pair a phone.</li>
            <li>Scan the code it shows.</li>
          </ol>
          <PairWithComputer onPaired={setComputer} />
          <button
            type="button"
            className={`${button.ghost} self-start`}
            onClick={() => {
              void setSetting(SOLO, true);
              onSolo();
            }}
          >
            No computer? Set up Lactic on this {phoneWord()}
          </button>
        </>
      )}
    </main>
  );
}
