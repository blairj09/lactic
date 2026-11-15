// Settings' sections, the old anchors that point into them, and the search over their blocks.
// Plain data so it tests in Vitest.

export type SectionId =
  | "profile"
  | "appearance"
  | "devices"
  | "coach"
  | "connections"
  | "health"
  | "phone"
  | "plugins"
  | "data"
  | "experimental"
  | "help";

export interface SectionInfo {
  id: SectionId;
  label: string;
  /** One short line under the section's title. */
  line: string;
  /** Listed under "More" at the bottom of the menu. */
  more?: boolean;
}

export const SECTIONS: SectionInfo[] = [
  { id: "profile", label: "Profile", line: "Your numbers, body and time zone." },
  { id: "appearance", label: "Appearance", line: "How Lactic looks and what's where." },
  { id: "devices", label: "Trainer and devices", line: "Pair once and your gear reconnects on its own." },
  { id: "coach", label: "Coach", line: "Built-in, an AI app you already use, or none." },
  { id: "connections", label: "Connections", line: "Rides in and out." },
  { id: "health", label: "Health", line: "What you track, and where it comes from." },
  { id: "phone", label: "Phone", line: "Lactic on your phone, synced over Wi-Fi." },
  { id: "plugins", label: "Plugins", line: "Add-ons for your ride screen and ride pages." },
  { id: "data", label: "Your data", line: "Back it up, take it anywhere, or delete it." },
  { id: "experimental", label: "Experimental", line: "New things we're still trying out.", more: true },
  { id: "help", label: "Help and about", line: "Tour, feedback and your version.", more: true },
];

/** Older anchors and ?section= values (tour, coach, links on other pages) and the section each lives in now. */
const ALIASES: Record<string, SectionId> = {
  "coach-settings": "coach",
  gear: "devices",
  bluetooth: "devices",
  "head-unit": "devices",
  layout: "appearance",
  units: "appearance",
  tracking: "health",
  iphone: "phone",
  computer: "phone",
  strava: "connections",
  intervals: "connections",
  import: "connections",
  tour: "help",
  feedback: "help",
  about: "help",
};

/** The section an anchor or ?section= value opens, or null for the menu. */
export function sectionFor(anchor: string | null | undefined): SectionId | null {
  const key = (anchor ?? "").replace(/^#/, "").trim();
  if (!key) return null;
  if (SECTIONS.some((s) => s.id === key)) return key as SectionId;
  return ALIASES[key] ?? null;
}

export interface SearchEntry {
  section: SectionId;
  /** The block's title and description, plus other words a rider might type for it. */
  text: string;
}

/** Every word of the query must appear somewhere in the entry or its section's name. Case and accents don't matter. */
export function matches(entry: SearchEntry, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const label = SECTIONS.find((s) => s.id === entry.section)?.label ?? "";
  const hay = fold(`${entry.text} ${label}`);
  return words.every((w) => hay.includes(w));
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
