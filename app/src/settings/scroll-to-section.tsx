// Settings opened as /settings?section=<id> (from the External coach pill, the coach, the tour)
// scrolls to that section once it has rendered.

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const ALIASES: Record<string, string> = { coach: "coach-settings" };

export function ScrollToSection() {
  const section = useSearchParams().get("section");
  useEffect(() => {
    if (!section) return;
    const id = ALIASES[section] ?? section;
    let tries = 0;
    // Panels load their data first, so wait for the section to exist.
    const timer = setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 20) clearInterval(timer);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => clearInterval(timer);
  }, [section]);
  return null;
}
