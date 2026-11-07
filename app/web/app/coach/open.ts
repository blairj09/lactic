// Opens the coach drawer from anywhere on the page, and keeps its shortcut off during a ride.

const OPEN = "coach:open";

/** Opens the drawer, with `prompt` (if given) typed into the message box. */
export function openCoach(prompt?: string) {
  window.dispatchEvent(new CustomEvent(OPEN, { detail: { prompt } }));
}

/** Calls `listener` whenever something asks for the drawer; returns the unsubscribe. */
export function onOpenCoach(listener: (prompt?: string) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<{ prompt?: string }>).detail?.prompt);
  window.addEventListener(OPEN, handle);
  return () => window.removeEventListener(OPEN, handle);
}

// A ride in progress holds the keyboard shortcut off, so a stray ⌘K can't cover the workout.
let holds = 0;

/** Stops the shortcut from opening the drawer until the returned function is called. */
export function holdCoachShortcut(): () => void {
  holds++;
  let released = false;
  return () => {
    if (!released) holds--;
    released = true;
  };
}

export const shortcutHeld = () => holds > 0;
