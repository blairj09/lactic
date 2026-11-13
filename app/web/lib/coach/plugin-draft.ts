// Coach-drafted plugins (Lactic Modular): what the built-in coach is told about writing a plugin, and
// the first check of what it sends. The coach only drafts. Lactic checks the draft, runs it on the
// sample ride in the sandbox (src/plugins/coach-draft.ts), and the rider sees it on the same add or
// update screen as any other plugin. The coach can never add, switch on or update a plugin itself.
// Plain data, no browser APIs.

/** The plugin's code. Small on purpose: a field or a ride section, not a library. */
export const MAX_DRAFT_CODE = 64 * 1024;

export interface DraftArgs {
  /** The manifest as the coach wrote it, before Lactic's checks. Author and homepage are dropped. */
  manifest: Record<string, unknown>;
  code: string;
  reason: string;
}

/** Shape-checks draft_plugin's arguments. Throws a reason the coach can act on. */
export function checkDraftArgs(args: Record<string, unknown>): DraftArgs {
  let manifest = args.manifest;
  if (typeof manifest === "string") {
    try {
      manifest = JSON.parse(manifest);
    } catch {
      throw new Error("manifest is the manifest as a JSON object");
    }
  }
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) throw new Error("manifest is the manifest as a JSON object");
  const code = args.code;
  if (typeof code !== "string" || !code.trim()) throw new Error("code is the plugin's JavaScript, as one plain script");
  if (code.length > MAX_DRAFT_CODE) throw new Error(`code is over ${MAX_DRAFT_CODE / 1024} KB: keep the plugin small`);
  // The coach isn't an author or a website: the add screen says "written by your coach" instead.
  const { author: _author, homepage: _homepage, ...rest } = manifest as Record<string, unknown>;
  return {
    manifest: { apiVersion: 1, main: "main.js", publishes: [], ...rest, contributes: normalContributes(rest.contributes) },
    code,
    reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 300) : "",
  };
}

/** Missing lists become empty ones, so a draft with only fields doesn't fail on `widgets`. */
function normalContributes(c: unknown): unknown {
  if (typeof c !== "object" || c === null || Array.isArray(c)) return c;
  const o = c as Record<string, unknown>;
  return { fields: [], widgets: [], ...o };
}

/** The coach's chat prompt line. Only in Lactic Modular, where plugins exist. */
export const PLUGIN_DRAFT_GUIDE = `- Drafting plugins: when the rider asks for something Lactic doesn't show (a ride field, a section on a ride's page, a card in the Plugins tab), you can write a small plugin for it. Call plugin_guide first, then draft_plugin. Lactic checks it and runs it on a sample ride; if it fails you get the error, so fix it and call draft_plugin again. The rider then sees it with Review and add, on the same screen as any plugin; you can't add, switch on or update it yourself. Only draft when they ask for something like this, use only the permissions it needs, say in a sentence what it reads and adds, and point out it's AI-written code they can read before adding. To change one you drafted, call draft_plugin again with the same id and a higher version. Plugins never go on Today. Once it's added, you can offer to put a ride field on a ride page with propose_layout_change.`;
