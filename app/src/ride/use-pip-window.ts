// The desktop app's ride overlay: a native always-on-top window in place of Chrome's Document
// Picture-in-Picture. Shaped like the web hook, so the Ride page uses it unchanged. Its `pip` is a
// stand-in Window with just what the page calls: setInterval (ticks from the overlay, which keeps
// running while the page is behind other windows) and resizeTo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePipWindow as useWebPip } from "@/app/ride/use-pip-window";
import { invoke, isDesktop, listen } from "~/platform/native";
import { EV } from "./channel";
import { isDemo } from "~/demo/flag";

function nativeStandIn(): Window {
  const timers = new Map<number, Promise<() => void>>();
  let next = 1;
  const standIn = {
    setInterval(fn: () => void) {
      const id = next++;
      timers.set(id, listen(EV.tick, () => fn()));
      return id;
    },
    clearInterval(id: number) {
      void timers.get(id)?.then((stop) => stop());
      timers.delete(id);
    },
    async resizeTo(width: number, height: number) {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const { LogicalSize } = await import("@tauri-apps/api/dpi");
      await (await WebviewWindow.getByLabel("overlay"))?.setSize(new LogicalSize(width, height));
    },
  };
  return standIn as unknown as Window;
}

function useNativePip() {
  const [pip, setPip] = useState<Window | null>(null);
  const standIn = useMemo(nativeStandIn, []);

  useEffect(() => {
    const stop = listen(EV.closed, () => setPip(null));
    return () => void stop.then((f) => f());
  }, []);

  const open = useCallback(
    async (width: number, height: number) => {
      await invoke("overlay_open", { width, height });
      setPip(standIn);
      return standIn;
    },
    [standIn],
  );
  const close = useCallback(() => {
    void invoke("overlay_close");
    setPip(null);
  }, []);
  // Close the overlay with the page, so it doesn't linger with stale numbers.
  useEffect(() => close, [close]);

  return { supported: true, pip, open, close, needsClick: false, floatsOverFullScreen: true };
}

/** The website demo runs in a browser on Chrome's picture-in-picture, but it stands for the desktop
 * app, so the Ride page describes the desktop overlay (which floats over full-screen apps). */
function useDemoPip(...args: Parameters<typeof useWebPip>) {
  return { ...useWebPip(...args), needsClick: false, floatsOverFullScreen: true };
}

export const usePipWindow = isDesktop ? useNativePip : isDemo ? useDemoPip : useWebPip;
