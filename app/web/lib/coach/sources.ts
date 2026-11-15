// Web pages the coach read for a reply (search_web), shown as links under it. Pure: checked here so
// nothing a search returns reaches the page unless it's a plain http(s) link.

export interface Source {
  url: string;
  title: string;
}

const MAX_SOURCES = 6;

/** The site's name for a chip: "dcrainmaker.com" from "https://www.dcrainmaker.com/2026/…". */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Keeps http(s) links only, one per page, at most six, with a short title. */
export function cleanSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  const out: Source[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { url, title } = item as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 2000) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    parsed.hash = "";
    const href = parsed.toString();
    if (out.some((s) => s.url === href)) continue;
    const name = typeof title === "string" && title.trim() ? title.trim().replace(/\s+/g, " ").slice(0, 120) : siteOf(href);
    out.push({ url: href, title: name });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/** Sources saved on a message's meta. */
export const sourcesOf = (meta: Record<string, unknown> | undefined) => cleanSources(meta?.sources);
