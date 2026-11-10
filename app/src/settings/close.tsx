// Leaving Settings goes back to the page you opened it from, scrolled where you were (see
// src/app/place.ts). Opened straight to Settings with nothing before it, it goes to Today.

import { useNavigate } from "react-router";
import { button } from "@/components/ui";

export function useCloseSettings() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) void navigate(-1);
    else void navigate("/");
  };
}

export function CloseSettings() {
  const close = useCloseSettings();
  return (
    <button type="button" onClick={close} className={button.secondary}>
      Done
    </button>
  );
}
