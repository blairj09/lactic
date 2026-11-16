"use client";

import { createPortal } from "react-dom";
import { MiniPlayer, type PlayerControls, type PlayerData } from "./player";

/** Renders the ride overlay into the Picture-in-Picture window (the desktop app swaps in its own window). */
export default function OverlayPortal({ pip, data, controls, onResize, onClose }: { pip: Window; data: PlayerData; controls: PlayerControls; onResize: (step: 1 | -1) => void; onClose?: () => void }) {
  return createPortal(<MiniPlayer data={data} controls={controls} onResize={onResize} onClose={onClose} />, pip.document.body);
}
