// Sends the overlay what to show on every render of the Ride page, and runs its button presses.

import { useEffect, useRef } from "react";
import OverlayPortalWeb from "@/app/ride/overlay-portal";
import type { PlayerControls, PlayerData } from "@/app/ride/player";
import { isDesktop, listen } from "~/platform/native";
import { EV, type ControlMessage, type OverlayPayload } from "./channel";

async function send(payload: OverlayPayload) {
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("overlay", EV.data, payload);
}

function NativeOverlay({ data, controls, onResize }: { data: PlayerData; controls: PlayerControls; onResize: (step: 1 | -1) => void }) {
  const latest = useRef({ data, controls, onResize });
  latest.current = { data, controls, onResize };

  useEffect(() => {
    void send({ data, canPlay: controls.canPlay });
  });

  useEffect(() => {
    const stops = [
      listen<ControlMessage>(EV.control, ({ name, args }) => {
        const { controls, onResize } = latest.current;
        if (name === "resize") return onResize(args[0] as 1 | -1);
        const fn = controls[name] as ((...a: unknown[]) => void) | undefined;
        fn?.(...args);
      }),
      listen(EV.ready, () => void send({ data: latest.current.data, canPlay: latest.current.controls.canPlay })),
    ];
    return () => stops.forEach((s) => void s.then((f) => f()));
  }, []);
  return null;
}

export default function OverlayPortal(props: { pip: Window; data: PlayerData; controls: PlayerControls; onResize: (step: 1 | -1) => void }) {
  return isDesktop ? <NativeOverlay {...props} /> : <OverlayPortalWeb {...props} />;
}
