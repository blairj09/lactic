// Settings → Plugins (Lactic Modular): what's added, on or off on this computer, whether the coach
// sees its numbers, and adding from GitHub or a file. Updates found on GitHub are only offered.
import { useCallback, useEffect, useRef, useState } from "react";
import { button, Result } from "@/components/ui";
import { GROUP_WORDS, type InstallChoices } from "~/plugins/permissions";
import { approvePlugin, installPlugin, listPlugins, preparePackage, removePlugin, setCoachVisible, setPluginEnabled, updatePlugin, type PluginRecord, type Prepared } from "~/plugins/store";
import { checkForUpdates, type Offer } from "~/plugins/updates";
import { PACKAGE_EXTENSION } from "~/plugins/package";
import { GitHubDialog, PermissionDialog, PluginIcon, RefusedDialog, sourceChange, sourceLabel, UpdateDialog } from "./plugin-dialogs";

type Open =
  | { kind: "github" }
  | { kind: "add"; prepared: Extract<Prepared, { kind: "new" }>; origin: string | null }
  | { kind: "update"; prepared: Extract<Prepared, { kind: "update" }>; origin: string | null }
  | { kind: "approve"; plugin: PluginRecord }
  | { kind: "refused"; reason: string };

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-sm text-muted disabled:opacity-50">
      <span className={`relative inline-block h-5 w-9 flex-none rounded-full transition-colors ${on ? "bg-primary" : "bg-active"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full transition-all ${on ? "left-[1.125rem] bg-on-primary" : "left-0.5 bg-muted"}`} />
      </span>
      {label}
    </button>
  );
}

const groupShort = (g: keyof typeof GROUP_WORDS) => GROUP_WORDS[g].name.split(",")[0].toLowerCase();

function summary(p: PluginRecord) {
  const m = p.manifest;
  const reads = m.permissions.read.map(groupShort);
  return [m.author && `by ${m.author}`, `from ${sourceLabel(p.origin)}`, reads.length ? `reads ${reads.join(", ")}` : "reads nothing of yours"].filter(Boolean).join(" · ");
}

function PluginRow({ p, offer, onOpen, onError }: { p: PluginRecord; offer?: Offer; onOpen: (o: Open) => void; onError: (e: string) => void }) {
  const [removing, setRemoving] = useState(false);
  const run = (f: () => Promise<unknown>) => void f().catch((e) => onError(e instanceof Error ? e.message : String(e)));
  const approved = p.state === "on" || p.state === "off";
  return (
    <li className="space-y-3 py-4">
      <div className="flex gap-3">
        <PluginIcon name={p.manifest.name} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {p.manifest.name} <span className="font-normal text-muted">{p.manifest.version}</span>
          </p>
          <p className="text-sm text-muted">{summary(p)}</p>
        </div>
      </div>
      {offer && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {offer.changes.to} is out.
          <button type="button" className={button.small} onClick={() => onOpen({ kind: "update", prepared: offer, origin: offer.origin })}>
            See what changes
          </button>
        </p>
      )}
      {(p.state === "needs-approval" || p.state === "changed") && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {p.state === "changed" ? "Changed since you approved it." : "Off on this computer until you approve it."}
          <button type="button" className={button.small} onClick={() => onOpen({ kind: "approve", plugin: p })}>
            Review
          </button>
        </p>
      )}
      {p.state === "switched-off" && (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Switched off because it kept failing. Your rides weren't affected.
          <button type="button" className={button.small} onClick={() => run(() => setPluginEnabled(p.pluginId, true))}>
            Turn on again
          </button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Switch on={p.state === "on"} disabled={!approved} label="On" onChange={(on) => run(() => setPluginEnabled(p.pluginId, on))} />
        {p.manifest.publishes.length > 0 && <Switch on={Boolean(p.grant?.coachVisible)} disabled={!p.grant} label="Coach sees its numbers" onChange={(on) => run(() => setCoachVisible(p.pluginId, on))} />}
        <span className="ml-auto flex items-center gap-2">
          {removing ? (
            <>
              <span className="text-sm text-muted">Remove it and its numbers?</span>
              <button type="button" className={`${button.small} text-negative`} onClick={() => run(() => removePlugin(p.pluginId))}>
                Remove
              </button>
              <button type="button" className={button.small} onClick={() => setRemoving(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={button.ghost} onClick={() => setRemoving(true)}>
              Remove
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<PluginRecord[] | null>(null);
  const [offers, setOffers] = useState<Map<string, Offer>>(new Map());
  const [open, setOpen] = useState<Open | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const checked = useRef(false);

  const load = useCallback(async () => {
    const list = await listPlugins();
    setPlugins(list);
    if (!checked.current) {
      checked.current = true;
      setOffers(await checkForUpdates(list));
    } else setOffers((o) => new Map([...o].filter(([id, offer]) => list.find((p) => p.pluginId === id)?.sha256 === offer.current.sha256)));
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("lactic:plugins", refresh);
    return () => window.removeEventListener("lactic:plugins", refresh);
  }, [load]);

  async function handle(text: string, origin: string | null) {
    setNote(null);
    const prepared = await preparePackage(text);
    if (prepared.kind === "new") setOpen({ kind: "add", prepared, origin });
    else if (prepared.kind === "update") setOpen({ kind: "update", prepared, origin });
    else if (prepared.kind === "same") {
      setOpen(null);
      setNote({ ok: true, text: `${prepared.current.manifest.name} ${prepared.current.manifest.version} is already added.` });
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

  return (
    <div className="space-y-3 text-sm sm:col-span-2">
      {plugins && plugins.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {plugins.map((p) => (
            <PluginRow key={p.pluginId} p={p} offer={offers.get(p.pluginId)} onOpen={setOpen} onError={(t) => setNote({ ok: false, text: t })} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button.secondary} onClick={() => setOpen({ kind: "github" })}>
          Add from GitHub…
        </button>
        <button type="button" className={button.secondary} onClick={() => file.current?.click()}>
          Add from a file…
        </button>
        <input ref={file} type="file" accept={`${PACKAGE_EXTENSION},application/json`} className="hidden" onChange={(e) => void chooseFile(e)} />
      </div>
      <p className="text-muted">Updates are never automatic.</p>
      {note && <Result ok={note.ok}>{note.text}</Result>}

      {open?.kind === "github" && <GitHubDialog onClose={close} onFound={(text, origin) => handle(text, origin)} />}
      {open?.kind === "refused" && <RefusedDialog reason={open.reason} onClose={close} />}
      {open?.kind === "add" && (
        <PermissionDialog
          manifest={open.prepared.pkg.manifest}
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
