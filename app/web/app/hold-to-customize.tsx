"use client";

// On a touch screen, holding a Today card for half a second opens Customize Today, the way the
// Home Screen goes into edit mode. A scroll or a lift before then is an ordinary touch.

import { useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const HOLD_MS = 500;
const SLOP_PX = 10;

export default function HoldToCustomize({ children }: { children: ReactNode }) {
  const router = useRouter();
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
  } | null>(null);
  const cancel = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };
  return (
    <div
      className="[-webkit-touch-callout:none] pointer-coarse:select-none"
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        cancel();
        hold.current = {
          x: e.clientX,
          y: e.clientY,
          timer: setTimeout(() => {
            hold.current = null;
            navigator.vibrate?.(10);
            router.push("/?customize=1");
          }, HOLD_MS),
        };
      }}
      onPointerMove={(e) => {
        const h = hold.current;
        if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP_PX)
          cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        if (hold.current) e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
