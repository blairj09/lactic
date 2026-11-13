// The screens for adding, approving and updating a plugin, and for a file Lactic refuses. Every word
// a plugin supplies (name, author, description, titles) comes from its checked manifest and is shown
// as plain text; the description is marked as the author's own words.
import { useEffect, useRef, useState } from "react";
import { button, input, Notice, Result } from "@/components/ui";
import type { MetricGroup } from "@shared/sdk";
import type { PluginManifest } from "~/plugins/manifest";
import { GROUP_WORDS, OPT_IN_GROUPS, type InstallChoices, type UpdateChanges } from "~/plugins/permissions";
import { CATALOG_CODE_URL, CATALOG_ORIGIN, catalogEntries, catalogState, catalogText, type CatalogEntry } from "~/plugins/catalog";
import { openExternal } from "~/platform/native";
import { GitHubError, fetchFromGitHub, originOf, parseRepoLink, sourceChange, sourceLabel } from "~/plugins/github";

export { sourceChange, sourceLabel };

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function PluginIcon({ name }: { name: string }) {
  return <span className="flex size-9 flex-none items-center justify-center rounded-md bg-plugin-soft text-xs font-semibold text-plugin">{initials(name)}</span>;
}

function Dialog({ title, labelId, onClose, busy, children }: { title: React.ReactNode; labelId: string; onClose: () => void; busy?: boolean; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const close = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [busy, onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 px-2 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-16 sm:pb-16"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelId} className="relative w-full max-w-lg space-y-4 rounded-xl border border-line bg-ground p-5 text-sm shadow-2xl outline-none sm:p-6">
        <h2 id={labelId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-line p-3">
      <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-muted">{hint}</span>
      </span>
    </label>
  );
}

function ReadLine({ group, mark }: { group: MetricGroup; mark?: "new" }) {
  const w = GROUP_WORDS[group];
  return (
    <li className="flex gap-2">
      <span aria-hidden className={w.health ? "text-negative" : "text-positive"}>
        {w.health ? "♥" : "✓"}
      </span>
      <span className="flex-1">
        <span className="font-medium">{w.name}:</span> <span className="text-muted">{w.what}</span>
      </span>
      {mark && <NewTag />}
    </li>
  );
}

const NewTag = () => <span className="h-5 flex-none rounded bg-plugin-soft px-1.5 text-xs font-semibold text-plugin">NEW</span>;

function adds(m: PluginManifest): string[] {
  return [
    ...m.contributes.fields.map((c) => `Ride field: ${c.title}`),
    ...m.contributes.widgets.map((c) => `Card: ${c.title}`),
    ...(m.contributes.analyses ?? []).map((c) => `Ride analysis: ${c.title}`),
  ];
}

const CANT = "It can't go online, change your rides, plan or settings, control your trainer, or see your coach chats.";

function Head({ manifest, origin, line }: { manifest: PluginManifest; origin: string | null; line?: string }) {
  return (
    <div className="flex gap-3">
      <PluginIcon name={manifest.name} />
      <p className="text-muted">{line ?? [manifest.author && `by ${manifest.author}`, manifest.version, `from ${sourceLabel(origin)}`].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

/** Add a new plugin, or approve one on this computer (it came by sync or a backup, or changed). */
export function PermissionDialog({
  manifest,
  origin,
  mode,
  warning,
  onConfirm,
  onClose,
}: {
  manifest: PluginManifest;
  origin: string | null;
  mode: "add" | "approve";
  warning?: string | null;
  onConfirm: (choices: InstallChoices) => Promise<void>;
  onClose: () => void;
}) {
  const [location, setLocation] = useState(false);
  const [coach, setCoach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reads = manifest.permissions.read.filter((g) => !OPT_IN_GROUPS.includes(g));
  const list = adds(manifest);
  // One of Lactic's own plugins: only set for a bundled package (catalog.ts; store.ts checks the hash).
  const ours = origin === CATALOG_ORIGIN;

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ location, coachVisible: coach });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={mode === "add" ? `Add “${manifest.name}”?` : `Turn on “${manifest.name}” here?`} labelId="plugin-permission-title" onClose={onClose} busy={busy}>
      <Head manifest={manifest} origin={origin} />
      {warning && <Notice>{warning}</Notice>}
      <blockquote className="border-l-2 border-plugin-line pl-3">
        <span className="block text-xs text-faint">{ours ? "What it does" : "The author says"}</span>
        {manifest.description}
      </blockquote>
      {list.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">Adds</p>
          <ul className="space-y-0.5 text-muted">
            {list.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <p className="font-medium">Reads</p>
        {reads.length ? (
          <ul className="space-y-1">
            {reads.map((g) => (
              <ReadLine key={g} group={g} />
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing of yours.</p>
        )}
      </div>
      {manifest.permissions.read.includes("location") && <Checkbox checked={location} onChange={setLocation} label="Also let it see where you ride" hint="GPS routes can show where you live. It works without them." />}
      {manifest.publishes.length > 0 && <Checkbox checked={coach} onChange={setCoach} label="Let your coach see its numbers" hint="Numbers only. You can change this later." />}
      <p className="text-muted">{CANT}</p>
      <p className="text-xs text-faint">{ours ? "Approved on this computer only." : "Lactic doesn't check plugins. Approved on this computer only."}</p>
      {error && <Result ok={false}>{error}</Result>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={button.primary} disabled={busy} onClick={() => void go()}>
          {mode === "add" ? "Add plugin" : "Turn on"}
        </button>
      </div>
    </Dialog>
  );
}

/** A newer (or different) version of an installed plugin. Nothing changes without Update. */
export function UpdateDialog({
  manifest,
  origin,
  previousOrigin,
  changes,
  coachVisible,
  onConfirm,
  onClose,
}: {
  manifest: PluginManifest;
  /** Where this file came from (null for a chosen file). */
  origin: string | null;
  /** Where the installed version came from. */
  previousOrigin: string | null;
  changes: UpdateChanges;
  coachVisible: boolean;
  onConfirm: (choices: InstallChoices) => Promise<void>;
  onClose: () => void;
}) {
  const [location, setLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newReads = changes.newReads.filter((g) => !OPT_IN_GROUPS.includes(g));
  const kept = manifest.permissions.read.filter((g) => !changes.newReads.includes(g) && !OPT_IN_GROUPS.includes(g));
  const added = [...changes.newFields.map((t) => `Ride field: ${t}`), ...changes.newWidgets.map((t) => `Card: ${t}`), ...changes.newMetrics.map((t) => `Number: ${t}`)];
  const nothingNew = !newReads.length && !added.length && !changes.newReads.includes("location");

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ location });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Update ${manifest.name} to ${changes.to}?`} labelId="plugin-update-title" onClose={onClose} busy={busy}>
      <Head manifest={manifest} origin={origin} line={`You have ${changes.from} from ${sourceLabel(previousOrigin)} · this one is from ${sourceLabel(origin)}`} />
      {changes.author && (
        <Notice>
          The author changed from {changes.author.from} to {changes.author.to}. If you didn't expect that, keep {changes.from}.
        </Notice>
      )}
      {sourceChange(previousOrigin, origin, changes.from) && <Notice>{sourceChange(previousOrigin, origin, changes.from)}</Notice>}
      {changes.direction === "older" && <Notice>This is an older version than yours.</Notice>}
      <div className="space-y-1">
        <p className="font-medium">What changes</p>
        {nothingNew ? (
          <p className="text-muted">Nothing new it can read or add.</p>
        ) : (
          <ul className="space-y-1">
            {newReads.map((g) => (
              <ReadLine key={g} group={g} mark="new" />
            ))}
            {added.map((a) => (
              <li key={a} className="flex gap-2">
                <span aria-hidden className="text-plugin">
                  ▦
                </span>
                <span className="flex-1">{a}</span>
                <NewTag />
              </li>
            ))}
          </ul>
        )}
        {changes.droppedReads.length > 0 && <p className="text-muted">Stops reading {changes.droppedReads.map((g) => GROUP_WORDS[g].name.split(",")[0]).join(", ")}.</p>}
      </div>
      {changes.newReads.includes("location") && <Checkbox checked={location} onChange={setLocation} label="Also let it see where you ride" hint="GPS routes can show where you live. It works without them." />}
      <p className="text-muted">
        {kept.length ? `Still reads ${kept.map((g) => GROUP_WORDS[g].name.split(",")[0].toLowerCase()).join(", ")}. ` : ""}
        Coach {coachVisible ? "sees" : "can't see"} its numbers. Still can't go online or change anything.
      </p>
      {error && <Result ok={false}>{error}</Result>}
      <div className="flex justify-end gap-2">
        <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
          Keep {changes.from}
        </button>
        <button type="button" className={button.primary} disabled={busy} onClick={() => void go()}>
          Update
        </button>
      </div>
    </Dialog>
  );
}

/** A file Lactic won't add, with the reason. */
export function RefusedDialog({ reason, onClose }: { reason: string; onClose: () => void }) {
  return (
    <Dialog title="Lactic can't add this plugin" labelId="plugin-refused-title" onClose={onClose}>
      <p>{reason} Nothing was added.</p>
      <div className="flex justify-end">
        <button type="button" className={button.primary} onClick={onClose}>
          OK
        </button>
      </div>
    </Dialog>
  );
}

/** Paste a GitHub link; Lactic fetches the latest release's .lacticplugin file and hands back its text. */
export function GitHubDialog({ onFound, onClose }: { onFound: (text: string, origin: string) => Promise<void>; onClose: () => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repo = parseRepoLink(link);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return setError("That isn't a GitHub repository link.");
    setBusy(true);
    setError(null);
    try {
      const { text } = await fetchFromGitHub(repo);
      await onFound(text, originOf(repo));
    } catch (err) {
      setError(err instanceof GitHubError ? err.message : "Couldn't reach GitHub.");
      setBusy(false);
    }
  }

  return (
    <Dialog title="Add from GitHub" labelId="plugin-github-title" onClose={onClose} busy={busy}>
      <form onSubmit={(e) => void go(e)} className="space-y-4">
        <label className="block space-y-1.5">
          <span className="block text-muted">Link to the plugin on GitHub. Lactic takes its latest release.</span>
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="github.com/owner/plugin"
            spellCheck={false}
            autoComplete="off"
            className={`${input} w-full`}
            aria-label="GitHub link"
          />
        </label>
        {error && <Result ok={false}>{error}</Result>}
        <div className="flex justify-end gap-2">
          <button type="button" className={button.secondary} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={button.primary} disabled={busy || !link.trim()}>
            {busy ? "Looking…" : "Continue"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function catalogWhere(e: CatalogEntry) {
  return [e.adds.fields.length && "Ride field", e.adds.analyses.length && "Ride page", e.adds.widgets.length && "Plugins tab"].filter(Boolean).join(" · ");
}

/** The first sentence of a catalog plugin's description, for the list. */
const firstSentence = (text: string) => text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;

/** Lactic's own plugins, bundled with the app. Picking one hands its text to the usual add or update screen. */
export function BrowseDialog({ installed, onPick, onClose }: { installed: Map<string, string>; onPick: (text: string) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(entry: CatalogEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      await onPick(await catalogText(entry));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <Dialog title="Lactic plugins" labelId="plugin-browse-title" onClose={onClose} busy={busy !== null}>
      <p className="-mt-2 text-muted">Made by Lactic and open source. Read the code to learn how they work.</p>
      <ul className="-mx-5 divide-y divide-line border-y border-line sm:-mx-6">
        {catalogEntries().map((e) => {
          const state = catalogState(e, installed.get(e.id) ?? null);
          return (
            <li key={e.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <PluginIcon name={e.name} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{e.name}</p>
                <p className="text-muted">{firstSentence(e.description)}</p>
                <p className="text-xs text-muted">{catalogWhere(e)}</p>
              </div>
              {state === "added" ? (
                <span className="flex-none text-positive">✓ Added</span>
              ) : (
                <button type="button" className={state === "update" ? button.smallPrimary : button.small} disabled={busy !== null} onClick={() => void pick(e)}>
                  {busy === e.id ? "Opening…" : state === "update" ? `Update to ${e.version}` : "Add"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <Result ok={false}>{error}</Result>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-muted underline" onClick={() => void openExternal(CATALOG_CODE_URL)}>
          See the code on GitHub
        </button>
        <button type="button" className={button.secondary} disabled={busy !== null} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
