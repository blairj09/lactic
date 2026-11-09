// The desktop app's ride overlay: a native always-on-top window in place of Chrome's Document
// Picture-in-Picture. Shaped like the web hook, so the Ride page uses it unchanged. Its `pip` is a
// stand-in Window with just what the page calls: setInterval (ticks from the overlay, which keeps
// running while the page is behind other windows) and resizeTo.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePipWindow as useWebPip, type OverlayFullScreen } from "@/app/ride/use-pip-window";
import { invoke, isDesktop, listen, os } from "~/platform/native";
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
  // A guess from the OS until the core says (it knows Wayland from X11).
  const [fullScreen, setFullScreen] = useState<OverlayFullScreen>(() => (os() === "macos" ? "floats" : os() === "windows" ? "windows" : "x11"));
  useEffect(() => {
    invoke<OverlayFullScreen>("overlay_support").then(setFullScreen, () => {});
  }, []);

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

  return { supported: true, pip, open, close, needsClick: false, fullScreen };
}

/** The website demo runs inside the lactic.fit page (an iframe), where Chrome refuses to open a
 * picture-in-picture window, so the demo draws the overlay in the page, floating over a mock riding
 * game (see overlay-scene). It stands for the desktop app's overlay, which floats over full screen. */
function useDemoPip() {
  const [pip, setPip] = useState<Window | null>(null);
  const close = useCallback(() => setPip(null), []);
  // The scene comes down once React has taken the overlay out of its window.
  useEffect(() => {
    if (!pip) return;
    return () => void import("~/demo/overlay-scene").then((m) => m.closeOverlayScene(pip));
  }, [pip]);
  const open = useCallback(
    async (width: number, height: number) => {
      const { openOverlayScene } = await import("~/demo/overlay-scene");
      const win = await openOverlayScene(width, height, () => setPip(null));
      setPip(win);
      return win;
    },
    [],
  );
  return { supported: true, pip, open, close, needsClick: false, fullScreen: "floats" as OverlayFullScreen };
}

export type { OverlayFullScreen };

export const usePipWindow = isDesktop ? useNativePip : isDemo ? useDemoPip : useWebPip;
