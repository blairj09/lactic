// Characters that can hide or disguise plugin text: control and format characters (zero-width,
// bidirectional marks, soft hyphen), Unicode "tag" characters (invisible copies of ASCII that AI
// models still read, a known way to smuggle instructions), variation selectors, blank "filler"
// letters, line and paragraph separators, private-use and unassigned code points. Plugin names,
// labels and anything a plugin returns are refused (manifest, output) or cleaned (coach) with this.
// Plain data, no browser or Node APIs.

const HIDDEN = "[\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}\\p{Zl}\\p{Zp}\\p{Cs}\\u034f\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u2800\\u3164\\ufe00-\\ufe0f\\uffa0\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}]";

const HIDDEN_ONE = new RegExp(HIDDEN, "u");
const HIDDEN_ALL = new RegExp(HIDDEN, "gu");
// Emoji need the zero-width joiner (U+200D) and the emoji/text variation selectors (U+FE0E, U+FE0F).
const EMOJI_PARTS = /\u200d|\ufe0e|\ufe0f/g;

/** True when the text holds any character that could hide or disguise words. `emoji` allows the
 *  joiner and variation selectors that emoji such as ❤️ need (fine on screen, not in names). */
export function hasHiddenText(s: string, { emoji = false }: { emoji?: boolean } = {}): boolean {
  return HIDDEN_ONE.test(emoji ? s.replace(EMOJI_PARTS, "") : s);
}

/** The text with every such character replaced by `with` (a space by default). */
export function stripHiddenText(s: string, replacement = " "): string {
  return s.replace(HIDDEN_ALL, replacement);
}
