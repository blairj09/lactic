// GET /api/stats: how often Lactic has been downloaded, from GitHub's per-file download counts.
// Nothing here touches visitors: GitHub counts each file fetch and publishes the totals.
//
// Each release's files fall into:
//   installs  .dmg, .deb: only people installing fetch these
//   updates   Mac .app.tar.gz: only the in-app updater fetches it
//   mixed     Windows -setup.exe, Linux .AppImage: new installs and in-app updates both fetch these
//   checks    latest.json: fetched when an installed copy checks for updates
// Signatures (.sig) and the Preview channel's release are left out.

const REPO = process.env.GITHUB_REPO || "blairj09/lactic";

export const KINDS = [
  { id: "mac", label: "Mac", test: (n) => n.endsWith(".dmg"), kind: "install" },
  { id: "macUpdate", label: "Mac updates", test: (n) => n.endsWith(".app.tar.gz"), kind: "update" },
  { id: "windows", label: "Windows", test: (n) => /-setup\.exe$/.test(n), kind: "mixed" },
  { id: "appimage", label: "Linux AppImage", test: (n) => n.endsWith(".AppImage"), kind: "mixed" },
  { id: "deb", label: "Linux .deb", test: (n) => n.endsWith(".deb"), kind: "install" },
  { id: "checks", label: "Update checks", test: (n) => n === "latest.json", kind: "check" },
];

function tally(assets) {
  const counts = Object.fromEntries(KINDS.map((k) => [k.id, 0]));
  for (const a of assets || []) {
    const k = KINDS.find((x) => x.test(a.name));
    if (k) counts[k.id] += a.download_count || 0;
  }
  return counts;
}

export function summarize(releases) {
  const list = (releases || [])
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({
      version: String(r.tag_name || "").replace(/^v/, ""),
      published: r.published_at || null,
      counts: tally(r.assets),
    }))
    .sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const totals = Object.fromEntries(KINDS.map((k) => [k.id, list.reduce((s, r) => s + r.counts[k.id], 0)]));
  // Downloads people started by hand: installers, plus Windows and AppImage (which updates also fetch).
  const downloads = (c) => c.mac + c.windows + c.appimage + c.deb;
  for (const r of list) r.downloads = downloads(r.counts);
  return {
    repo: REPO,
    kinds: KINDS.map(({ id, label, kind }) => ({ id, label, kind })),
    totals: { ...totals, downloads: downloads(totals) },
    releases: list,
    at: new Date().toISOString(),
  };
}

let memo = null; // { at, data } per function instance
async function load() {
  if (memo && Date.now() - memo.at < 300_000) return memo.data;
  const headers = { accept: "application/vnd.github+json", "user-agent": "lactic-site" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  let res = await fetch(url, { headers });
  if (!res.ok && headers.authorization) {
    delete headers.authorization;
    res = await fetch(url, { headers });
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = summarize(await res.json());
  memo = { at: Date.now(), data };
  return data;
}

export async function GET() {
  try {
    return new Response(JSON.stringify(await load()), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
        "x-robots-tag": "noindex",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Couldn't reach GitHub." }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
