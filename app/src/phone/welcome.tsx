// The iPhone's first screen: one question, two equal answers. Pair with Lactic on a computer, which
// brings everything across (the plan, rides, settings), or use this iPhone on its own. Pairing
// opens its own short screen with the steps and the Scan button.

import { useState } from "react";
import { MarkTile } from "~/app/brand";
import { button, Result } from "@/components/ui";
import { setSetting } from "~/settings/store";
import { PairWithComputer, useLinkState } from "./settings";

/** app_settings key: this phone was set up without a computer. */
export const SOLO = "phone.solo";

const frame = "mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]";

function Choice({ title, line, onPick }: { title: string; line: string; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:bg-raised active:bg-raised">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted">{line}</span>
      </span>
      <svg viewBox="0 0 24 24" className="size-5 flex-none text-faint" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}

export function PhoneWelcome({ onSolo }: { onSolo: () => void }) {
  const [pairing, setPairing] = useState(false);
  const [computer, setComputer] = useState<string | null>(null);
  const link = useLinkState();

  if (computer)
    return (
      <main className={frame}>
        <MarkTile size={56} />
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
      </main>
    );

  if (pairing)
    return (
      <main className={frame}>
        <MarkTile size={56} />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Pair with your computer</h1>
          <p className="text-muted">Your computer keeps your plan, rides and settings. This iPhone syncs with it, reads Apple Health and runs rides.</p>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>On your computer, open Lactic → Settings → iPhone.</li>
          <li>Click Pair an iPhone.</li>
          <li>Scan the code it shows.</li>
        </ol>
        <PairWithComputer onPaired={setComputer} />
        <button type="button" className={`${button.ghost} self-start`} onClick={() => setPairing(false)}>
          Back
        </button>
      </main>
    );

  return (
    <main className={frame}>
      <MarkTile size={56} />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Lactic</h1>
        <p className="text-muted">A training plan that fits your week, workouts on your smart trainer, and your recovery in one place. Free.</p>
      </div>
      <div className="space-y-3">
        <Choice title="Pair with your computer" line="Lactic on your Mac or PC keeps everything. This iPhone syncs with it and can steer its rides." onPick={() => setPairing(true)} />
        <Choice
          title="Use this iPhone on its own"
          line="No computer needed. Your plan, rides with your trainer and Apple Health, all on this iPhone."
          onPick={() => {
            void setSetting(SOLO, true);
            onSolo();
          }}
        />
      </div>
      <p className="text-sm text-faint">Got a computer later? Pair it any time in Settings → Your computer.</p>
    </main>
  );
}
