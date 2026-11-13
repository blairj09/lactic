// Adding a plugin from GitHub. Lactic (never the plugin) asks GitHub for a repository's latest
// release, takes its one .lacticplugin file and hands the text to the same checks as a chosen
// file. Prereleases and drafts are skipped (GitHub's "latest" never returns them). Nothing installs
// without the permission or update screen; an update check only says a newer file exists.
import { CATALOG_ORIGIN, COACH_ORIGIN } from "./catalog";
import { MAX_PACKAGE_BYTES, PACKAGE_EXTENSION } from "./package";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface ReleaseFile {
  repo: RepoRef;
  tag: string;
  name: string;
  url: string;
  size: number;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/** What's stored on the plugin row and shown as its source. */
export const originOf = (r: RepoRef) => `github:${r.owner}/${r.repo}`;

export function parseOrigin(origin: string | null | undefined): RepoRef | null {
  const m = origin?.match(/^github:([^/]+)\/([^/]+)$/);
  return m ? parseRepoLink(`${m[1]}/${m[2]}`) : null;
}

export const repoLabel = (r: RepoRef) => `github.com/${r.owner}/${r.repo}`;

/** Words for a package coming from somewhere other than where the rider added it, or null when it's the same place. */
export function sourceChange(from: string | null, to: string | null, keep: string): string | null {
  if (from === to) return null;
  return `This comes from ${sourceLabel(to)}, not ${sourceLabel(from)} where you added it. If you didn't expect that, keep ${keep}.`;
}

export function sourceLabel(origin: string | null) {
  // listPlugins only keeps this origin on a package Lactic shipped (catalog.ts isCatalogPackage).
  if (origin === CATALOG_ORIGIN) return "Lactic";
  if (origin === COACH_ORIGIN) return "your coach";
  const repo = parseOrigin(origin);
  return repo ? repoLabel(repo) : "a file";
}


/** Accepts a github.com link (any page of the repository) or owner/repo. */
export function parseRepoLink(text: string): RepoRef | null {
  let t = text.trim();
  if (!t) return null;
  t = t.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  if (/^github\.com\//i.test(t)) t = t.slice("github.com/".length);
  else if (t.includes(".") && t.indexOf(".") < t.indexOf("/")) return null; // another site
  const [owner, rawRepo] = t.split(/[/?#]/);
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

export class GitHubError extends Error {}

const API = "https://api.github.com";
const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

/** The latest full release's .lacticplugin file. Throws GitHubError with words for the rider. */
export async function latestPluginFile(repo: RepoRef, fetchFn: Fetch = fetch): Promise<ReleaseFile> {
  let res: Response;
  try {
    res = await fetchFn(`${API}/repos/${repo.owner}/${repo.repo}/releases/latest`, { headers: HEADERS });
  } catch {
    throw new GitHubError("Couldn't reach GitHub.");
  }
  if (res.status === 404) throw new GitHubError("No release found there.");
  if (res.status === 403 || res.status === 429) throw new GitHubError("GitHub is busy. Try again in a few minutes.");
  if (!res.ok) throw new GitHubError("GitHub didn't answer. Try again later.");
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new GitHubError("GitHub didn't answer. Try again later.");
  }
  const rel = body as { tag_name?: unknown; prerelease?: unknown; draft?: unknown; assets?: unknown };
  if (rel.prerelease === true || rel.draft === true) throw new GitHubError("No release found there.");
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const files = assets.filter((a): a is { name: string; browser_download_url: string; size: number } => {
    const x = a as Record<string, unknown>;
    return typeof x?.name === "string" && x.name.toLowerCase().endsWith(PACKAGE_EXTENSION) && typeof x.browser_download_url === "string" && typeof x.size === "number";
  });
  if (files.length === 0) throw new GitHubError(`Its latest release has no ${PACKAGE_EXTENSION} file.`);
  if (files.length > 1) throw new GitHubError(`Its latest release has more than one ${PACKAGE_EXTENSION} file.`);
  const f = files[0];
  if (!isGitHubDownload(f.browser_download_url, repo)) throw new GitHubError("That release file isn't on GitHub.");
  if (f.size > MAX_PACKAGE_BYTES) throw new GitHubError("Its plugin file is larger than 1 MB.");
  return { repo, tag: typeof rel.tag_name === "string" ? rel.tag_name.slice(0, 60) : "", name: f.name, url: f.browser_download_url, size: f.size };
}

/** Release downloads live at github.com/<owner>/<repo>/releases/download/...; GitHub redirects from there. */
function isGitHubDownload(url: string, repo: RepoRef): boolean {
  try {
    const u = new URL(url);
    const prefix = `/${repo.owner}/${repo.repo}/releases/download/`.toLowerCase();
    return u.protocol === "https:" && u.hostname === "github.com" && u.pathname.toLowerCase().startsWith(prefix);
  } catch {
    return false;
  }
}

/** The file's text, for preparePackage. */
export async function downloadPluginFile(file: ReleaseFile, fetchFn: Fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchFn(file.url, { headers: { accept: "application/octet-stream" } });
  } catch {
    throw new GitHubError("Couldn't download it from GitHub.");
  }
  if (!res.ok) throw new GitHubError("Couldn't download it from GitHub.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_PACKAGE_BYTES) throw new GitHubError("Its plugin file is larger than 1 MB.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubError("That isn't a plugin file.");
  }
}

/** Add-from-GitHub in one go: the release's file and its text. */
export async function fetchFromGitHub(repo: RepoRef, fetchFn: Fetch = fetch): Promise<{ file: ReleaseFile; text: string }> {
  const file = await latestPluginFile(repo, fetchFn);
  return { file, text: await downloadPluginFile(file, fetchFn) };
}
