// What the iPhone app runs while it's open, in place of the computer's background jobs: syncing
// with the computer, and Apple Health both ways. A phone used without a computer runs intervals.icu
// itself; once paired, the computer does that.

import { syncPhoneHealth } from "./health";
import { startLink, syncWithComputer } from "./link";
import { onHealthWake, phoneStatus } from "./plugin";

const INTERVALS_EVERY_MS = 20 * 60_000;

async function intervalsIfAlone() {
  if ((await phoneStatus()).paired) return;
  const { syncNow } = await import("~/integrations/background");
  await syncNow("intervals");
}

export function startPhone(): () => void {
  const stopLink = startLink();
  const alone = () => void intervalsIfAlone().catch(() => {});
  const firstAlone = setTimeout(alone, 3000);
  const aloneTimer = setInterval(alone, INTERVALS_EVERY_MS);
  // Health first, so a new night is in before the sync carries it to the computer.
  const both = () => void syncPhoneHealth().then(() => syncWithComputer());
  both();
  const onVisible = () => {
    if (document.visibilityState === "visible") both();
  };
  document.addEventListener("visibilitychange", onVisible);
  // Synced rides from the computer may be new rides to write to Health.
  const onData = () => void import("./health").then((h) => h.writeRides());
  const stopWake = onHealthWake(both).catch(() => () => {});
  let last = 0;
  const onChanged = () => {
    if (Date.now() - last > 60_000) {
      last = Date.now();
      onData();
    }
  };
  window.addEventListener("lactic:data-changed", onChanged);
  return () => {
    clearTimeout(firstAlone);
    clearInterval(aloneTimer);
    stopLink();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("lactic:data-changed", onChanged);
    void stopWake.then((s) => s());
  };
}
