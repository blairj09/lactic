// The computer's side of a paired iPhone, for what Rust (phone.rs) hands to the web layer: Apple
// Health that a background wake on the phone read and sent straight here, and the phone's remote
// for a ride on this computer. Rows the phone sends in a sync are applied by Rust; this just
// refreshes the screens.

import { ingestHealth, IPHONE_SETTING, type IphoneHealth } from "~/integrations/apple-health";
import { invoke, isDesktop, isPhone, listen } from "~/platform/native";
import { applySharedPrefs } from "~/settings/shared-prefs";
import { getSetting, setSetting } from "~/settings/store";
import { revalidatePath } from "~/shims/next-cache";
import { remoteRide, runRemoteControl } from "~/ride/remote";
import type { ControlMessage } from "~/ride/channel";
import { logEvent } from "~/support/log";

interface PhoneRequest {
  requestId: number;
  kind: string;
  body: Record<string, unknown>;
}

export function startPhoneBridge(): () => void {
  if (!isDesktop || isPhone()) return () => {};
  const stops: Promise<() => void>[] = [
    listen<PhoneRequest>("phone:request", async (req) => {
      try {
        if (req.kind === "ride") {
          const control = req.body.control as ControlMessage | undefined;
          // A press re-renders the Ride page; answer with what it shows after that.
          // The phone's ride-end notification fires on a timer it set while unlocked: Extend from it
          // only counts if the workout really is at its end (not paused short of it since).
          const due = !req.body.whenFinished || remoteRide()?.data.finished === true;
          if (control && due && runRemoteControl(control)) await new Promise((r) => setTimeout(r, 150));
          await invoke("phone_respond", { requestId: req.requestId, result: { ride: remoteRide() }, error: null });
          return;
        }
        if (req.kind !== "health") throw new Error(`Unknown request ${req.kind}`);
        const r = await ingestHealth(req.body);
        const at = new Date().toISOString();
        await setSetting("health.lastImport", { at, nights: r.nights, days: r.days, latest: r.latest, failed: [], from: "iphone" });
        const was = await getSetting<IphoneHealth | null>(IPHONE_SETTING, null);
        await setSetting(IPHONE_SETTING, { at, nights: r.nights, days: r.days, latest: r.latest ?? was?.latest ?? null } satisfies IphoneHealth);
        revalidatePath("/");
        await invoke("phone_respond", { requestId: req.requestId, result: r, error: null });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logEvent("health", "error", `From the iPhone: ${message}`);
        await invoke("phone_respond", { requestId: req.requestId, result: null, error: message });
      }
    }),
    listen("phone:changed", () => {
      // Units or a ride habit changed on the phone (settings/shared-prefs.ts).
      void applySharedPrefs().catch(() => {});
      revalidatePath("/");
    }),
    // A key typed on the phone arrived (secrets.rs): Settings shows it's saved.
    listen("secrets:changed", () => {
      revalidatePath("/");
      window.dispatchEvent(new CustomEvent("lactic:settings", { detail: "secrets" }));
    }),
    // A phone brought its data to this new computer: start over on it, set up and all.
    listen("phone:adopted", () => {
      location.hash = "#/";
      location.reload();
    }),
  ];
  return () => stops.forEach((p) => void p.then((stop) => stop()));
}
