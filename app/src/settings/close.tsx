// Leaving Settings goes back to the page you opened it from, scrolled where you were (see
// src/app/place.ts), however many sections you opened on the way. Opened straight to Settings
// with nothing before it, it goes to Today.

import { useNavigate } from "react-router";
import { places } from "~/app/place";
import { RESTORE } from "~/app/place-keeper";
import { button } from "@/components/ui";

export function useCloseSettings() {
  const navigate = useNavigate();
  return () => void navigate(places.beforeSettings() ?? "/", { state: RESTORE });
}

export function CloseSettings() {
  const close = useCloseSettings();
  return (
    <button type="button" onClick={close} className={button.secondary}>
      Done
    </button>
  );
}
