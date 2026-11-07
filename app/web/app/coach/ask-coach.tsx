"use client";

// "Ask coach" beside an error: opens the coach with the problem already written, so it can check
// the app and help. Shown only when the built-in coach is on (html[data-coach], see globals.css).

import { button } from "@/components/ui";
import { openCoach } from "./open";

export function AskCoach({ prompt }: { prompt: string }) {
  return (
    <button type="button" className={`coach-button ${button.small}`} onClick={() => openCoach(prompt)}>
      Ask coach
    </button>
  );
}
