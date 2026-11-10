// The computer's side of a paired iPhone, for what Rust (phone.rs) hands to the web layer: Apple
// Health that a background wake on the phone read and sent straight here, and the phone's remote
// for a ride on this computer. Rows the phone sends in a sync are applied by Rust; this just
// refreshes the screens.

import { ingestHealth } from "~/integrations/apple-health";
import { invoke, isDesktop, isPhone, listen } from "~/platform/native";
import { setSetting } from "~/settings/store";
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
          if (control && runRemoteControl(control)) await new Promise((r) => setTimeout(r, 150));
          await invoke("phone_respond", { requestId: req.requestId, result: { ride: remoteRide() }, error: null });
          return;
        }
        if (req.kind !== "health") throw new Error(`Unknown request ${req.kind}`);
        const r = await ingestHealth(req.body);
        await setSetting("health.lastImport", { at: new Date().toISOString(), nights: r.nights, days: r.days, latest: r.latest, failed: [], from: "iphone" });
        revalidatePath("/");
        await invoke("phone_respond", { requestId: req.requestId, result: r, error: null });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logEvent("health", "error", `From the iPhone: ${message}`);
        await invoke("phone_respond", { requestId: req.requestId, result: null, error: message });
      }
    }),
    listen("phone:changed", () => revalidatePath("/")),
  ];
  return () => stops.forEach((p) => void p.then((stop) => stop()));
}
