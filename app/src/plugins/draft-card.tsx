// A plugin the coach drafted, as a card in the coach chat (Lactic Modular). The card re-reads the
// draft's file like any file a rider picks and runs it on the sample ride; Review and add opens the
// usual add or update screen. Only that screen adds the plugin, and only a plugin the coach drafted
// can be updated from a draft.
import { useEffect, useState } from "react";
import type { Proposal } from "@/lib/coach/changes";
import type { AppSetting } from "@/lib/coach/app-tools";
import { button } from "@/components/ui";
import {
  CodeView,
  PermissionDialog,
  PluginIcon,
  UpdateDialog,
} from "~/settings/plugin-dialogs";
import { PluginPreview } from "~/settings/plugin-preview";
import { COACH_ORIGIN } from "./catalog";
import {
  installPlugin,
  preparePackage,
  updatePlugin,
  type Prepared,
} from "./store";

export type DraftSetting = Extract<AppSetting, { setting: "plugin_draft" }>;

/** The draft in a proposal, if it is one. */
export function pluginDraft(p: Proposal): DraftSetting | null {
  return p.change.kind === "app" && p.change.setting.setting === "plugin_draft"
    ? p.change.setting
    : null;
}

/** What the card can do with the draft, worked out from the plugins added now. */
type Ready =
  | { kind: "add"; prepared: Extract<Prepared, { kind: "new" }> }
  | { kind: "update"; prepared: Extract<Prepared, { kind: "update" }> }
  | { kind: "blocked"; reason: string };

function readiness(prepared: Prepared): Ready {
  if (prepared.kind === "new") return { kind: "add", prepared };
  if (prepared.kind === "update") {
    if (prepared.current.origin !== COACH_ORIGIN)
      return {
        kind: "blocked",
        reason:
          "You already have a plugin with this id that your coach didn't write.",
      };
    if (prepared.changes.direction !== "newer")
      return {
        kind: "blocked",
        reason: `You have ${prepared.current.manifest.version} already.`,
      };
    return { kind: "update", prepared };
  }
  if (prepared.kind === "same")
    return { kind: "blocked", reason: "Already added." };
  return { kind: "blocked", reason: prepared.reason };
}

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function PluginDraftCard({
  proposal,
  onAdded,
  onDismiss,
}: {
  proposal: Proposal;
  onAdded: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const draft = pluginDraft(proposal)!;
  const pending = proposal.status === "pending";
  const [ready, setReady] = useState<Ready | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [code, setCode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    void preparePackage(draft.file).then((p) => live && setReady(readiness(p)));
    return () => {
      live = false;
    };
  }, [draft.file, pending]);

  const pkg = ready && ready.kind !== "blocked" ? ready.prepared.pkg : null;
  const status =
    proposal.status === "applied"
      ? draft.update
        ? "Updated"
        : "Added"
      : proposal.status === "dismissed"
        ? "Dismissed"
        : ready?.kind === "blocked"
          ? ready.reason
          : "Drafted by your coach · not added";

  async function added() {
    setReviewing(false);
    setBusy(true);
    try {
      await onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-plugin-line bg-surface p-4 text-sm">
      <div className="flex items-center gap-3">
        <PluginIcon name={draft.name} />
        <div className="min-w-0">
          <p className="font-medium">
            {draft.update
              ? `Update ${draft.name} to ${draft.version}`
              : draft.name}
          </p>
          <p className="text-xs text-muted">{status}</p>
        </div>
      </div>
      {pending && pkg && (
        <PluginPreview manifest={pkg.manifest} source={pkg.source} />
      )}
      <p className="text-muted">
        {capital(draft.summary.slice(draft.summary.indexOf(": ") + 2))}
      </p>
      {proposal.reason && <p className="text-muted">{proposal.reason}</p>}
      {pending && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={button.smallPrimary}
            disabled={busy || !pkg}
            onClick={() => setReviewing(true)}
          >
            {draft.update ? "Review update" : "Review and add"}
          </button>
          <button
            type="button"
            className={button.small}
            disabled={busy}
            onClick={() => void onDismiss()}
          >
            Dismiss
          </button>
          {pkg && (
            <button
              type="button"
              className="ml-auto text-xs text-muted underline"
              aria-expanded={code}
              onClick={() => setCode(!code)}
            >
              {code ? "Hide code" : "Code"}
            </button>
          )}
        </div>
      )}
      {code && pkg && <CodeView source={pkg.source} />}
      {reviewing && ready?.kind === "add" && (
        <PermissionDialog
          manifest={ready.prepared.pkg.manifest}
          source={ready.prepared.pkg.source}
          origin={COACH_ORIGIN}
          mode="add"
          onClose={() => setReviewing(false)}
          onConfirm={async (choices) => {
            await installPlugin(ready.prepared.pkg, choices, COACH_ORIGIN);
            await added();
          }}
        />
      )}
      {reviewing && ready?.kind === "update" && (
        <UpdateDialog
          manifest={ready.prepared.pkg.manifest}
          source={ready.prepared.pkg.source}
          origin={COACH_ORIGIN}
          previousOrigin={ready.prepared.current.origin}
          changes={ready.prepared.changes}
          coachVisible={ready.prepared.current.grant?.coachVisible === true}
          onClose={() => setReviewing(false)}
          onConfirm={async (choices) => {
            await updatePlugin(ready.prepared.pkg, choices, COACH_ORIGIN);
            await added();
          }}
        />
      )}
    </div>
  );
}
