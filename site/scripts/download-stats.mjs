// How often Lactic has been downloaded, from GitHub's per-file download counts. Not deployed as a
// page: run `node scripts/download-stats.mjs` (from site/) to print a table.
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
  // Mirrors, scanners and crawlers fetch every file of a release, so each pass adds one to every
  // installer (and to the .sig files, which no person or updater fetches). A rider fetches only
  // their own system's. So the lowest installer count is the floor of those every-file passes, and
  // what sits above it is likely people (us included).
  for (const r of list) {
    const c = r.counts;
    r.downloads = downloads(c);
    r.sweeps = Math.min(c.mac, c.windows, c.appimage, c.deb);
    r.likely = r.downloads - 4 * r.sweeps;
  }
  const sum = (k) => list.reduce((s, r) => s + r[k], 0);
  return {
    repo: REPO,
    kinds: KINDS.map(({ id, label, kind }) => ({ id, label, kind })),
    totals: { ...totals, downloads: downloads(totals), likely: sum("likely"), sweeps: sum("sweeps") },
    releases: list,
    at: new Date().toISOString(),
  };
}

export async function load() {
  const headers = { accept: "application/vnd.github+json", "user-agent": "lactic-site" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return summarize(await res.json());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = await load();
  const t = d.totals;
  console.log(`Likely people ${t.likely} · raw ${t.downloads} · bot sweeps ${t.sweeps} · Mac updates ${t.macUpdate} · update checks ${t.checks}`);
  console.table(d.releases.map((r) => ({ version: r.version, likely: r.likely, raw: r.downloads, sweeps: r.sweeps, ...r.counts })));
}
