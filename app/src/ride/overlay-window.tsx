// The overlay window's page: the web app's MiniPlayer, fed by the Ride page in the main window.

import { useEffect, useMemo, useState } from "react";
import { MiniPlayer, type PlayerControls } from "@/app/ride/player";
import { listen } from "~/platform/native";
import { EV, sendableArgs, type ControlMessage, type ControlName, type OverlayPayload } from "./channel";

async function control(name: ControlName, args: unknown[]) {
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("main", EV.control, { name, args: sendableArgs(args) } satisfies ControlMessage);
}

export default function OverlayWindow() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("overflow-hidden");
    const stop = listen<OverlayPayload>(EV.data, setPayload);
    void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("main", EV.ready));
    // This window stays visible on top of other windows, so its timer keeps the ride clock honest.
    const tick = setInterval(() => void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("main", EV.tick)), 250);
    const closed = () => void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("main", EV.closed));
    window.addEventListener("beforeunload", closed);
    return () => {
      void stop.then((f) => f());
      clearInterval(tick);
      window.removeEventListener("beforeunload", closed);
    };
  }, []);

  const controls = useMemo(() => {
    const names: ControlName[] = ["onPlayPause", "onSkip", "onBack", "onIntensity", "onErg", "onErgMode", "onGrade", "onExtend", "onEnd", "onExtendMinutes", "onExtendWatts", "onExtendKind", "onExtendBlock", "onHold", "onAdaptUndo", "onAdaptYes", "onAdaptNo", "onAdaptive"];
    return Object.fromEntries(names.map((n) => [n, (...args: unknown[]) => void control(n, args)])) as unknown as Omit<PlayerControls, "canPlay">;
  }, []);

  // Drag the window from anywhere that isn't a control.
  const drag = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, a")) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  };

  if (!payload) return <div className="grid h-screen place-items-center bg-ground text-sm text-muted" onMouseDown={drag}>Waiting for the ride…</div>;
  return (
    <div className="h-screen bg-ground" onMouseDown={drag}>
      <MiniPlayer data={payload.data} controls={{ ...controls, canPlay: payload.canPlay }} onResize={(step) => void control("resize", [step])} />
    </div>
  );
}
