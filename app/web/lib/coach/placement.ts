const PLACE = String.raw`(?:right |just |directly )?(?:above|below|under(?:neath)?|beneath|beside)`;
const SPOT = String.raw`(?:this|the|my|your|these|those)(?: (?:morning's|today's))? (?:brief|message|note|text|card|page|words|options?|suggestions?)\b|(?:this|here)(?=[.,;:!?)]|$)`;
const THING = String.raw`options?|versions?|suggestions?|choices?|cards?|buttons?|workouts?|rides?|sessions?|ones?|changes?|proposals?`;

/**
 * The brief with positional pointers taken out ("the 45-minute version under this brief" → "the
 * 45-minute version"). The rider arranges Today as they like, so nothing is reliably above or below
 * the brief. Only phrases that point at the page go: "below threshold" or "under 200 W" stay.
 */
export function withoutPlacement(text: string) {
  return text
    .replace(new RegExp(String.raw`,?\s+(?:shown |listed |marked )?${PLACE} (?:${SPOT})`, "gi"), "")
    .replace(new RegExp(String.raw`\b(${THING})\s+(?:shown |listed )?${PLACE}(?=[.,;:!?)]|\s+(?:and|or|if|to|now|today|when|for)\b)`, "gi"), "$1")
    .replace(new RegExp(String.raw`\s*\((?:see )?(?:above|below)\)`, "gi"), "")
    .replace(new RegExp(String.raw`,?\s+(?:see|shown|listed) (?:above|below)\b`, "gi"), "")
    .replace(/ {2,}/g, " ");
}
