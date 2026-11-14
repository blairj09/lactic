// The Plugins tab (Lactic Modular): the one place for plugins. Cards shows plugin cards on the rider's
// screens; Added is where plugins are switched on or off, updated, approved and removed; Browse lists
// Lactic's own plugins. Adding from GitHub or a file starts here too. Updates are only ever offered.
import { useCallback, useEffect, useRef, useState } from "react";
import { button, Result } from "@/components/ui";
import type { Layout } from "@/lib/sdk/layout";
import { GROUP_WORDS, OPT_IN_GROUPS, type InstallChoices } from "./permissions";
import { approvePlugin, installPlugin, listPlugins, preparePackage, removePlugin, setCoachVisible, setPluginEnabled, updatePlugin, type PluginRecord, type Prepared } from "./store";
import { checkForUpdates, type Offer } from "./updates";
import { CATALOG_ORIGIN } from "./catalog";
import { PACKAGE_EXTENSION } from "./package";
import { CardsView } from "./plugins-tab";
import { adds, BrowseList, CANT, GitHubDialog, PermissionDialog, PluginIcon, ReadLine, RefusedDialog, sourceChange, sourceLabel, UpdateDialog } from "~/settings/plugin-dialogs";
import { PluginPreview } from "~/settings/plugin-preview";
import { SandboxCheck } from "~/settings/sandbox-check";
import { isDesktop } from "~/platform/native";

export type View = "cards" | "added" | "browse";

type Open =
  | { kind: "github" }
  | {
      kind: "add";
      prepared: Extract<Prepared, { kind: "new" }>;
      origin: string | null;
    }
  | {
      kind: "update";
      prepared: Extract<Prepared, { kind: "update" }>;
      origin: string | null;
    }
  | { kind: "approve"; plugin: PluginRecord }
  | { kind: "refused"; reason: string };

/** Where the tab opens: cards when a plugin has some, the list when plugins are added, else Browse. */
export function startView(plugins: PluginRecord[], asked?: string | null): View {
  if (asked === "cards" || asked === "added" || asked === "browse") return asked;
  if (plugins.some((p) => p.manifest.contributes.widgets.length > 0)) return "cards";
  return plugins.length > 0 ? "added" : "browse";
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-sm text-muted disabled:opacity-50">
      {label}
      <span className={`relative inline-block h-5 w-9 flex-none rounded-full transition-colors ${on ? "bg-primary" : "bg-active"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full transition-all ${on ? "left-[1.125rem] bg-on-primary" : "left-0.5 bg-muted"}`} />
      </span>
    </button>
  );
}

function Segments({ view, count, onPick }: { view: View; count: number; onPick: (v: View) => void }) {
  const items: [View, string][] = [
    ["cards", "Cards"],
    ["added", "Added"],
    ["browse", "Browse"],
  ];
  return (
    <nav aria-label="Plugins" className="inline-flex gap-0.5 rounded-lg bg-raised p-0.5">
      {items.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-current={v === view ? "page" : undefined}
          onClick={() => onPick(v)}
          className="rounded-md px-3.5 py-1.5 text-sm text-muted transition-colors hover:text-ink aria-[current=page]:bg-active aria-[current=page]:text-ink"
        >
          {label}
          {v === "added" && count > 0 && <span className="ml-1.5 text-faint">{count}</span>}
        </button>
      ))}
    </nav>
  );
}

function AddMenu({ onBrowse, onGitHub, onFile }: { onBrowse: () => void; onGitHub: () => void; onFile: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = (label: string, hint: string, go: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-active"
      onClick={() => {
        setOpen(false);
        go();
      }}
    >
      {label}
      <span className="block text-xs text-faint">{hint}</span>
    </button>
  );
  return (
    <div ref={box} className="relative">
      <button type="button" className={button.primary} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Add plugin ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-lg border border-line bg-surface p-1.5 shadow-xl">
          {item("Browse Lactic plugins", "Made by Lactic, open source", onBrowse)}
          {item("From GitHub…", "Paste a repo link", onGitHub)}
          {item("From a file…", PACKAGE_EXTENSION, onFile)}
        </div>
      )}
    </div>
  );
}

function where(p: PluginRecord): string[] {
  const c = p.manifest.contributes;
  return [c.fields.length > 0 && "Ride field", (c.analyses ?? []).length > 0 && "Ride page", c.widgets.length > 0 && "Card"].filter((x): x is string => Boolean(x));
}

const groupShort = (g: keyof typeof GROUP_WORDS) => GROUP_WORDS[g].name.split(",")[0].toLowerCase();

function reads(p: PluginRecord) {
  const r = (p.grant?.read ?? p.manifest.permissions.read).map(groupShort);
  return r.length ? `Reads ${r.join(", ")}` : "Reads nothing of yours";
}

function Chips({ items }: { items: string[] }) {
  return (
    <>
      {items.map((w) => (
        <span key={w} className="mr-1 inline-block rounded bg-raised px-1.5 py-px text-xs text-muted">
          {w}
        </span>
      ))}
    </>
  );
}

function StateNotes({ p, offer, onOpen, run }: { p: PluginRecord; offer?: Offer; onOpen: (o: Open) => void; run: (f: () => Promise<unknown>) => void }) {
  return (
    <>
      {offer && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-raised px-3 py-2 text-sm">
          {offer.changes.to} is out.
          <button type="button" className={button.small} onClick={() => onOpen({ kind: "update", prepared: offer, origin: offer.origin })}>
            See what changes
          </button>
        </p>
      )}
      {(p.state === "needs-approval" || p.state === "changed") && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-raised px-3 py-2 text-sm">
          {p.state === "changed" ? "Changed since you approved it." : "Off on this computer until you approve it."}
          <button type="button" className={button.small} onClick={() => onOpen({ kind: "approve", plugin: p })}>
            Review
          </button>
        </p>
      )}
      {p.state === "switched-off" && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-raised px-3 py-2 text-sm">
          Switched off because it kept failing. Your rides weren't affected.
          <button type="button" className={button.small} onClick={() => run(() => setPluginEnabled(p.pluginId, true))}>
            Turn on again
          </button>
        </p>
      )}
    </>
  );
}

const approved = (p: PluginRecord) => p.state === "on" || p.state === "off";

function AddedList({
  plugins,
  offers,
  onOpen,
  onDetails,
  run,
  onBrowse,
}: {
  plugins: PluginRecord[];
  offers: Map<string, Offer>;
  onOpen: (o: Open) => void;
  onDetails: (id: string) => void;
  run: (f: () => Promise<unknown>) => void;
  onBrowse: () => void;
}) {
  const [checking, setChecking] = useState(false);
  if (plugins.length === 0)
    return (
      <p className="text-sm text-muted">
        No plugins yet.{" "}
        <button type="button" className="underline" onClick={onBrowse}>
          Browse Lactic plugins
        </button>
      </p>
    );
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line border-y border-line">
        {plugins.map((p) => (
          <li key={p.pluginId} className="flex items-center gap-3 py-4">
            <PluginIcon name={p.manifest.name} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {p.manifest.name} <span className="text-sm font-normal text-faint">{p.manifest.version}</span>
              </p>
              <p className="mt-0.5 text-sm text-muted">
                <Chips items={where(p)} /> {p.origin && p.origin !== CATALOG_ORIGIN ? `From ${sourceLabel(p.origin)}` : reads(p)}
              </p>
              <StateNotes p={p} offer={offers.get(p.pluginId)} onOpen={onOpen} run={run} />
            </div>
            <Switch on={p.state === "on"} disabled={!approved(p)} label={p.state === "on" ? "On" : "Off"} onChange={(on) => run(() => setPluginEnabled(p.pluginId, on))} />
            <button type="button" className={button.small} onClick={() => onDetails(p.pluginId)}>
              Details
            </button>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-faint">
        Updates are never automatic.
        {isDesktop && (
          <button type="button" className="text-muted underline" onClick={() => setChecking((c) => !c)}>
            {checking ? "Hide sandbox check" : "Run sandbox check"}
          </button>
        )}
      </p>
      {checking && <SandboxCheck />}
    </div>
  );
}

function Details({ p, offer, onOpen, onBack, run }: { p: PluginRecord; offer?: Offer; onOpen: (o: Open) => void; onBack: () => void; run: (f: () => Promise<unknown>) => void }) {
  const [removing, setRemoving] = useState(false);
  const m = p.manifest;
  const granted = (p.grant?.read ?? m.permissions.read.filter((g) => !OPT_IN_GROUPS.includes(g))).filter((g) => g in GROUP_WORDS);
  const list = adds(m);
  return (
    <div className="space-y-4 text-sm">
      <button type="button" className="text-muted hover:text-ink" onClick={onBack}>
        ‹ Added
      </button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-3">
            <PluginIcon name={m.name} />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold">
                {m.name} <span className="text-sm font-normal text-faint">{m.version}</span>
              </h2>
              <p className="text-muted">{[m.author && `by ${m.author}`, `from ${sourceLabel(p.origin)}`].filter(Boolean).join(" · ")}</p>
            </div>
            <Switch on={p.state === "on"} disabled={!approved(p)} label={p.state === "on" ? "On" : "Off"} onChange={(on) => run(() => setPluginEnabled(p.pluginId, on))} />
          </div>
          <blockquote className="border-l-2 border-plugin-line pl-3 text-[15px]">
            <span className="block text-xs text-faint">{p.origin === CATALOG_ORIGIN ? "What it does" : "The author says"}</span>
            {m.description}
          </blockquote>
          <StateNotes p={p} offer={offer} onOpen={onOpen} run={run} />
          {list.length > 0 && (
            <div className="border-t border-line pt-4">
              <PluginPreview manifest={m} source={p.source} />
            </div>
          )}
        </div>
        <div className="space-y-0 divide-y divide-line">
          <section className="space-y-2 pb-4">
            <h3 className="text-xs text-faint">It reads</h3>
            {granted.length ? (
              <ul className="space-y-1.5">
                {granted.map((g) => (
                  <ReadLine key={g} group={g} />
                ))}
              </ul>
            ) : (
              <p className="text-muted">Nothing of yours.</p>
            )}
          </section>
          <section className="space-y-2 py-4">
            <h3 className="text-xs text-faint">It can't</h3>
            <p className="text-muted">{CANT.replace(/^It can't /, "").replace(/^./, (c) => c.toUpperCase())}</p>
          </section>
          <section className="space-y-2 py-4">
            <h3 className="text-xs text-faint">It adds</h3>
            <ul className="space-y-1 text-muted">
              {list.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
          {m.publishes.length > 0 && (
            <section className="py-4">
              <Switch on={Boolean(p.grant?.coachVisible)} disabled={!p.grant} label="Coach sees its numbers" onChange={(on) => run(() => setCoachVisible(p.pluginId, on))} />
            </section>
          )}
          <section className="flex flex-wrap items-center justify-end gap-2 pt-4">
            {removing ? (
              <>
                <span className="mr-auto text-muted">Remove it and its numbers?</span>
                <button type="button" className={`${button.small} text-negative`} onClick={() => run(() => removePlugin(p.pluginId).then(onBack))}>
                  Remove
                </button>
                <button type="button" className={button.small} onClick={() => setRemoving(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={`${button.small} text-negative`} onClick={() => setRemoving(true)}>
                Remove
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export function PluginsTab({ initial, asked }: { initial: Layout; asked?: string | null }) {
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [offers, setOffers] = useState<Map<string, Offer>>(new Map());
  const [view, setView] = useState<View | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const checked = useRef(false);

  const load = useCallback(async () => {
    const list = await listPlugins();
    setPlugins(list);
    setView((v) => v ?? startView(list, asked));
    if (!checked.current) {
      checked.current = true;
      setOffers(await checkForUpdates(list));
    } else setOffers((o) => new Map([...o].filter(([id, offer]) => list.find((p) => p.pluginId === id)?.sha256 === offer.current.sha256)));
  }, [asked]);

  useEffect(() => {
    void load().catch(() => setView((v) => v ?? "browse"));
    const refresh = () => void load();
    window.addEventListener("lactic:plugins", refresh);
    return () => window.removeEventListener("lactic:plugins", refresh);
  }, [load]);

  const run = (f: () => Promise<unknown>) => void f().catch((e) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  const pick = (v: View) => {
    setView(v);
    setDetails(null);
    setNote(null);
  };

  async function handle(text: string, origin: string | null) {
    setNote(null);
    const prepared = await preparePackage(text);
    if (prepared.kind === "new") setOpen({ kind: "add", prepared, origin });
    else if (prepared.kind === "update") setOpen({ kind: "update", prepared, origin });
    else if (prepared.kind === "same") {
      setOpen(null);
      setNote({
        ok: true,
        text: `${prepared.current.manifest.name} ${prepared.current.manifest.version} is already added.`,
      });
    } else setOpen({ kind: "refused", reason: prepared.reason });
  }

  async function chooseFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 1024 * 1024) return setOpen({ kind: "refused", reason: "It's larger than 1 MB." });
    await handle(await f.text(), null);
  }

  const close = () => setOpen(null);
  const done = (text: string) => setNote({ ok: true, text });
  const shown = details ? plugins?.find((p) => p.pluginId === details) : undefined;
  const none = plugins !== null && plugins.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
        {view && <Segments view={view} count={plugins?.length ?? 0} onPick={pick} />}
        <span className="ml-auto flex items-center gap-2">
          {none && view === "browse" ? (
            <>
              <button type="button" className={button.secondary} onClick={() => setOpen({ kind: "github" })}>
                From GitHub…
              </button>
              <button type="button" className={button.secondary} onClick={() => file.current?.click()}>
                From a file…
              </button>
            </>
          ) : (
            <AddMenu onBrowse={() => pick("browse")} onGitHub={() => setOpen({ kind: "github" })} onFile={() => file.current?.click()} />
          )}
        </span>
        <input ref={file} type="file" accept={`${PACKAGE_EXTENSION},application/json`} className="hidden" onChange={(e) => void chooseFile(e)} />
      </div>

      {note && <Result ok={note.ok}>{note.text}</Result>}

      {view === "cards" && <CardsView initial={initial} onBrowse={() => pick("browse")} />}
      {view === "added" &&
        plugins &&
        (shown ? (
          <Details p={shown} offer={offers.get(shown.pluginId)} onOpen={setOpen} onBack={() => setDetails(null)} run={run} />
        ) : (
          <AddedList plugins={plugins} offers={offers} onOpen={setOpen} onDetails={setDetails} run={run} onBrowse={() => pick("browse")} />
        ))}
      {view === "browse" && (
        <div className="space-y-4">
          {none && <p className="max-w-2xl text-[15px] text-muted">Add ride fields, ride page charts and cards. Plugins can't use the internet or change anything, and read only what you allow.</p>}
          <BrowseList installed={new Map((plugins ?? []).map((p) => [p.pluginId, p.manifest.version]))} onPick={(text) => handle(text, CATALOG_ORIGIN)} />
        </div>
      )}

      {open?.kind === "github" && <GitHubDialog onClose={close} onFound={(text, origin) => handle(text, origin)} />}
      {open?.kind === "refused" && <RefusedDialog reason={open.reason} onClose={close} />}
      {open?.kind === "add" && (
        <PermissionDialog
          manifest={open.prepared.pkg.manifest}
          source={open.prepared.pkg.source}
          origin={open.origin}
          mode="add"
          onClose={close}
          onConfirm={async (choices: InstallChoices) => {
            await installPlugin(open.prepared.pkg, choices, open.origin);
            done(`${open.prepared.pkg.manifest.name} is on.`);
          }}
        />
      )}
      {open?.kind === "update" &&
        (open.prepared.current.grant ? (
          <UpdateDialog
            manifest={open.prepared.pkg.manifest}
            origin={open.origin}
            previousOrigin={open.prepared.current.origin}
            changes={open.prepared.changes}
            coachVisible={open.prepared.current.grant.coachVisible}
            onClose={close}
            onConfirm={async (choices) => {
              await updatePlugin(open.prepared.pkg, choices, open.origin);
              done(`${open.prepared.pkg.manifest.name} is now ${open.prepared.pkg.manifest.version}.`);
            }}
          />
        ) : (
          <PermissionDialog
            manifest={open.prepared.pkg.manifest}
            origin={open.origin}
            mode="approve"
            warning={sourceChange(open.prepared.current.origin, open.origin, open.prepared.current.manifest.version)}
            onClose={close}
            onConfirm={async (choices) => {
              await updatePlugin(open.prepared.pkg, choices, open.origin);
              done(`${open.prepared.pkg.manifest.name} is on.`);
            }}
          />
        ))}
      {open?.kind === "approve" && (
        <PermissionDialog
          manifest={open.plugin.manifest}
          origin={open.plugin.origin}
          mode="approve"
          onClose={close}
          onConfirm={async (choices) => {
            await approvePlugin(open.plugin.pluginId, choices);
            done(`${open.plugin.manifest.name} is on.`);
          }}
        />
      )}
    </div>
  );
}
