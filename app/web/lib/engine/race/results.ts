// Official race results pasted as text (or read off a screenshot by the coach's vision model, which
// writes the same kind of text): each rider's place, name, total time and lap times. Results give a
// race its timing line and lap splits for the whole field, and give a GPX file without times a clock.

export interface ResultRow {
  place: number;
  name: string;
  /** Seconds; null when the row has no total. */
  total: number | null;
  /** Lap times, seconds. */
  laps: number[];
  /** Laps down on the winner ("-1 lap"), 0 on the lead lap. */
  lapsDown: number;
}

const TIME = /(?<![\d:.'])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?![\d:'])/g;

/** "8:12" → 492, "1:02:03" → 3723. */
export function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (!m) return null;
  return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

export function formatClock(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return `${seconds < 0 ? "-" : ""}${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${sec}`;
}

function nameIn(text: string): string {
  // "LAST, First" is how most timing companies list riders.
  const comma = text.match(/([A-Za-zÀ-ÿ'’.-]+(?: [A-Za-zÀ-ÿ'’.-]+)?),\s*([A-Za-zÀ-ÿ'’.-]+)/);
  if (comma) {
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    return `${comma[2]} ${comma[1].split(" ").map(cap).join(" ")}`;
  }
  const words = text.match(/[A-Za-zÀ-ÿ'’.-]{2,}/g) ?? [];
  return words.slice(0, 2).join(" ");
}

/** Reads one rider per line; lines without a place and a time are skipped (headers, notes). */
export function parseResults(text: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const place = line.match(/^(\d{1,3})\b/);
    if (!place) continue;
    const times = [...line.matchAll(TIME)].map((m) => parseClock(m[0])).filter((v): v is number => v !== null);
    if (!times.length) continue;
    const down = line.match(/-\s*(\d+)\s*laps?\b/i);
    const firstTime = line.search(TIME);
    // The name sits between the place (and bib) and the first time.
    const head = line.slice(place[0].length, firstTime >= 0 ? firstTime : undefined).replace(/^\s*\d+\s+/, "");
    let total: number | null = null;
    let laps: number[] = times;
    if (times.length >= 3) {
      const rest = times.slice(1);
      const sum = rest.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - times[0]) <= Math.max(3, rest.length)) {
        total = times[0];
        laps = rest;
      } else total = sum;
    } else if (times.length === 1) {
      total = times[0];
      laps = [];
    } else total = times.reduce((a, b) => a + b, 0);
    rows.push({ place: +place[1], name: nameIn(head), total, laps, lapsDown: down ? +down[1] : 0 });
  }
  return rows.sort((a, b) => a.place - b.place);
}

/** The row that best matches a name (the rider's own, or a rival's), by shared words. */
export function findRow(rows: ResultRow[], name: string | null | undefined): ResultRow | null {
  if (!name) return null;
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length > 1));
  const want = words(name);
  let best: ResultRow | null = null;
  let score = 0;
  for (const r of rows) {
    const have = words(r.name);
    const shared = [...want].filter((w) => have.has(w)).length;
    if (shared > score) {
      score = shared;
      best = r;
    }
  }
  return best;
}
