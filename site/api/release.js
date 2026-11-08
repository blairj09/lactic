// GET /api/release: the latest Lactic release, for the downloads page.
//   /api/release               JSON: version, date, and one installer per platform
//   /api/release?get=<id>      redirects to that installer (mac, windows, appimage, deb)
// Asset names carry the version (Lactic_0.1.2_aarch64.dmg), so links can't be fixed in the HTML.
// Anything that goes wrong falls back to the GitHub releases page. The CDN caches answers for five
// minutes, which keeps us far below GitHub's unauthenticated rate limit.

const REPO = process.env.GITHUB_REPO || "blairj09/lactic";
const RELEASES = `https://github.com/${REPO}/releases/latest`;

// id → how to spot the asset, and what the page calls it.
export const PLATFORMS = {
  mac: { test: (n) => n.endsWith(".dmg"), label: "Mac", detail: "Apple silicon (M1 or later)" },
  windows: { test: (n) => /-setup\.exe$/.test(n), label: "Windows", detail: "Windows 10 or 11, 64-bit" },
  appimage: { test: (n) => n.endsWith(".AppImage"), label: "Linux", detail: "AppImage, any distro" },
  deb: { test: (n) => n.endsWith(".deb"), label: "Linux", detail: "Debian and Ubuntu (.deb)" },
};

export function summarize(release) {
  const assets = release.assets || [];
  const installers = {};
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const a = assets.find((x) => p.test(x.name));
    if (a) installers[id] = { name: a.name, size: a.size, url: a.browser_download_url };
  }
  return {
    version: String(release.tag_name || "").replace(/^v/, ""),
    published: release.published_at || null,
    notes: release.html_url || RELEASES,
    installers,
  };
}

let memo = null; // { at, data } per function instance
async function latest() {
  if (memo && Date.now() - memo.at < 300_000) return memo.data;
  const headers = { accept: "application/vnd.github+json", "user-agent": "lactic-site" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  // A token without access to releases shouldn't break downloads: retry without it.
  if (!res.ok && headers.authorization) {
    delete headers.authorization;
    res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  }
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = summarize(await res.json());
  memo = { at: Date.now(), data };
  return data;
}

const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

export async function GET(request) {
  const get = new URL(request.url).searchParams.get("get");
  let data;
  try {
    data = await latest();
  } catch {
    if (get) return Response.redirect(RELEASES, 302);
    return new Response(JSON.stringify({ error: "Couldn't reach GitHub.", notes: RELEASES }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  if (get) {
    const installer = data.installers[get];
    return new Response(null, {
      status: 302,
      headers: { location: installer ? installer.url : RELEASES, "cache-control": CACHE },
    });
  }
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": CACHE },
  });
}
