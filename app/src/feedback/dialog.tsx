// Send feedback: a short form from the top bar (and Settings). The rider picks what it's about,
// writes a few lines and sends it, with no account needed; or opens it as a GitHub issue themselves.
// "Include screenshot" takes a picture of the screen behind the dialog and opens it for markup;
// Attach adds it. They can also add, paste or drop images, up to three. Version and OS always go
// along and are shown. The app check (gear, connections, recent activity) goes only if they tick
// it, and they can read every line of it first.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { button, Result, Segmented } from "@/components/ui";
import { checkApp } from "~/support/tools";
import { appInfo, openExternal } from "~/platform/native";
import { buildIssue, diagnosticsText, githubBody, githubIssueUrl, KINDS, MAX_MESSAGE, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, RELAY_URL, relayPayload, systemLine, type FeedbackKind, type Screenshot, type SystemInfo } from "./report";

import { Annotate, drawMarks, type Mark } from "./annotate";
import { captureScreen, FEEDBACK_UI } from "./capture";

/** `original` is the shrunk image before any marks, so marks stay editable. */
type Shot = Screenshot & { preview: string; original: string; marks: Mark[]; screen?: boolean };

/** Draws the marks onto the original and re-encodes it, staying under the size limit. */
async function flatten(shot: Shot, marks: Mark[]): Promise<Shot> {
  const img = new Image();
  img.src = shot.original;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  drawMarks(ctx, marks, canvas.width);
  for (let quality = 0.85; ; quality -= 0.1) {
    const url = canvas.toDataURL("image/jpeg", quality);
    const data = url.slice(url.indexOf(",") + 1);
    if (data.length * 0.75 <= MAX_SCREENSHOT_BYTES || quality < 0.45) return { ...shot, data, preview: url, marks };
  }
}

/** Shrinks an image to at most 1920 px wide and about 1 MB as a JPEG, so three fit in one request. */
async function toShot(file: File): Promise<Shot> {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1920 / bitmap.width);
  for (let quality = 0.85; ; quality -= 0.15) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", Math.max(quality, 0.4));
    const data = url.slice(url.indexOf(",") + 1);
    if (data.length * 0.75 <= MAX_SCREENSHOT_BYTES || scale < 0.3) {
      bitmap.close();
      const name = `${file.name.replace(/\.[^.]+$/, "") || "screenshot"}.jpg`.replace(/[^\w.-]+/g, "-");
      return { name, type: "image/jpeg", data, preview: url, original: url, marks: [] };
    }
    if (quality <= 0.55) scale *= 0.75;
  }
}

let open = false;
/** What the form opens with, when the coach wrote it up. */
let draft: { kind: FeedbackKind; message: string } | null = null;
const listeners = new Set<() => void>();
function setOpen(value: boolean) {
  open = value;
  if (!value) draft = null;
  listeners.forEach((l) => l());
}
/** Opens the feedback form, filled in with `prefill` when given (the coach's summary). */
export function openFeedback(prefill?: { kind: FeedbackKind; message: string }) {
  // A second offer while the form is open would be lost; the open form keeps what's in it.
  if (!open && prefill) draft = { kind: prefill.kind, message: prefill.message.slice(0, MAX_MESSAGE) };
  setOpen(true);
}
function useOpen() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => open,
  );
}

export function FeedbackButton() {
  const isOpen = useOpen();
  return (
    <>
      <button
        type="button"
        aria-label="Send feedback"
        title="Send feedback"
        data-tour="feedback"
        onClick={() => openFeedback()}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:text-ink"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {isOpen && <FeedbackDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** Settings → Feedback. */
export function FeedbackSetting() {
  return (
    <div className="sm:col-span-2">
      <button type="button" className={button.secondary} onClick={() => openFeedback()}>
        Send feedback
      </button>
    </div>
  );
}

type Sent = { ok: true; url: string | null; duplicate: boolean } | { ok: false; message: string };

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<FeedbackKind>(() => draft?.kind ?? "problem");
  const [message, setMessage] = useState(() => draft?.message ?? "");
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [attach, setAttach] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotError, setShotError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [capturing, setCapturing] = useState(false);

  /** A screenshot waiting in the markup view; it's attached only when they press Attach. */
  const [pending, setPending] = useState<Shot | null>(null);

  /** Takes a picture of the screen behind the dialog and opens it for markup. */
  async function includeScreen() {
    setCapturing(true);
    setShotError(null);
    const file = await captureScreen();
    try {
      if (!file) throw new Error();
      setPending({ ...(await toShot(file)), screen: true });
    } catch {
      setShotError("Couldn't take a screenshot. You can add an image instead.");
    }
    setCapturing(false);
  }

  async function addFiles(files: Iterable<File>) {
    setShotError(null);
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    for (const file of images) {
      try {
        const shot = await toShot(file);
        setShots((list) => (list.length >= MAX_SCREENSHOTS ? list : [...list, shot]));
      } catch {
        setShotError(`Couldn't read ${file.name || "that image"}.`);
      }
    }
  }
  const text = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    text.current?.focus();
    void appInfo()
      .then((i) => setSystem({ version: i.version, os: i.os, arch: i.arch, osVersion: i.osVersion }))
      .catch(() => setSystem({ version: "unknown", os: "unknown", arch: "" }));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // Read the app check once, when they first ask for it, so they see exactly what would go.
  useEffect(() => {
    if ((attach || showCheck) && diagnostics === null) {
      void checkApp("all")
        .then((r) => setDiagnostics(diagnosticsText(r)))
        .catch((e) => setDiagnostics(JSON.stringify({ error: e instanceof Error ? e.message : String(e) })));
    }
  }, [attach, showCheck, diagnostics]);

  const ready = message.trim().length > 0 && system !== null && (!attach || diagnostics !== null);
  const input = () => ({ kind, message, system: system!, diagnostics: attach ? diagnostics : null, screenshots: shots.map(({ name, type, data }) => ({ name, type, data })) });

  async function send() {
    setSending(true);
    setSent(null);
    try {
      const res = await fetch(RELAY_URL, { method: "POST", headers: { "content-type": "application/json", "x-lactic-client": system!.version }, body: JSON.stringify(relayPayload(input())) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; duplicate?: boolean };
      if (!res.ok) throw new Error(body.error ?? `The feedback service answered ${res.status}.`);
      setSent({ ok: true, url: body.url ?? null, duplicate: Boolean(body.duplicate) });
    } catch (e) {
      setSent({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  }

  async function openGithub() {
    const { url, trimmed } = githubIssueUrl(githubBody(buildIssue(input()), shots.length));
    if (trimmed && diagnostics) {
      try {
        await navigator.clipboard.writeText(diagnostics);
        setNote("The app check was too long for the link, so it's on your clipboard. Paste it into the issue.");
      } catch {
        setNote("The app check was too long for the link. Untick it, or copy it from below.");
        setShowCheck(true);
      }
    }
    await openExternal(url);
  }

  return (
    <div {...{ [FEEDBACK_UI]: "" }} className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-3 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }} aria-labelledby="feedback-title" className="relative w-full max-w-lg space-y-5 rounded-xl border border-line bg-ground p-5 shadow-2xl sm:p-6">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-md text-xl text-muted hover:bg-raised hover:text-ink">
          ×
        </button>
        <div className="space-y-1 pr-8">
          <h2 id="feedback-title" className="text-lg font-semibold">
            Send feedback
          </h2>
          <p className="text-sm text-muted">Tell us what's broken, confusing or missing. Every note is read.</p>
        </div>

        {sent?.ok ? (
          <div className="space-y-4">
            <p className="text-sm">{sent.duplicate ? "Thanks. Someone had already reported this, so yours was added to their report." : "Thanks, it's sent."}</p>
            {sent.url && (
              <button type="button" className={button.ghost} onClick={() => void openExternal(sent.url!)}>
                See it on GitHub
              </button>
            )}
            <div className="flex justify-end">
              <button type="button" className={button.primary} onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <Segmented label="What's it about" options={KINDS} value={kind} onChange={setKind} fill />
            <textarea
              ref={text}
              value={message}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder={kind === "problem" ? "What happened, and what did you expect?" : kind === "idea" ? "What would make Lactic better for you?" : "What's on your mind?"}
              className="block w-full resize-y rounded-md border border-control bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-ink"
            />

            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {shots.map((shot, i) => (
                  <div key={i} className="relative">
                    <button type="button" title="Mark it up" aria-label={shot.screen ? "Mark up the screen capture" : `Mark up screenshot ${i + 1}`} onClick={() => setEditing(i)} className="group block">
                      <img src={shot.preview} alt="" className="h-16 w-24 rounded-md border border-line object-cover group-hover:opacity-80" />
                      <span className="absolute inset-x-0 bottom-1 text-center text-[11px] font-medium text-white opacity-0 drop-shadow group-hover:opacity-100">Mark up</span>
                    </button>
                    <button
                      type="button"
                      aria-label={shot.screen ? "Remove the screen capture" : `Remove screenshot ${i + 1}`}
                      onClick={() => setShots((list) => list.filter((_, j) => j !== i))}
                      className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full border border-line bg-ground text-xs text-muted hover:text-ink"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {capturing && <span className="flex h-16 w-24 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">Capturing…</span>}
                {!capturing && shots.length < MAX_SCREENSHOTS && (
                  <button type="button" className={button.small} onClick={() => void includeScreen()}>
                    Include screenshot
                  </button>
                )}
                {shots.length < MAX_SCREENSHOTS && (
                  <button type="button" className={button.small} onClick={() => picker.current?.click()}>
                    Add image
                  </button>
                )}
                <input
                  ref={picker}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {shots.length === 0 && !capturing ? <span className="text-muted">or paste one in</span> : shots.length > 0 && <span className="text-muted">Click one to mark it up again.</span>}
              </div>
              {shotError && <Result ok={false}>{shotError}</Result>}
              {pending && (
                <Annotate
                  src={pending.original}
                  initial={[]}
                  doneLabel="Attach"
                  onCancel={() => setPending(null)}
                  onDone={(marks) => {
                    const shot = pending;
                    setPending(null);
                    void flatten(shot, marks).then((s) => setShots((list) => (list.length >= MAX_SCREENSHOTS ? list : [...list, s])));
                  }}
                />
              )}
              {editing !== null && shots[editing] && (
                <Annotate
                  src={shots[editing].original}
                  initial={shots[editing].marks}
                  onCancel={() => setEditing(null)}
                  onDone={(marks) => {
                    const i = editing;
                    setEditing(null);
                    void flatten(shots[i], marks).then((shot) => setShots((list) => list.map((s, j) => (j === i ? shot : s))));
                  }}
                />
              )}
              <p className="text-muted">Sent with it: {system ? systemLine(system) : "…"}</p>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-0.5" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
                <span>
                  <span className="block font-medium">Include an app check</span>
                  <span className="text-muted">Your paired gear, connections and recent activity, so we can see what went wrong. No keys or passwords.</span>
                </span>
              </label>
              <button type="button" className={button.ghost} onClick={() => setShowCheck((v) => !v)}>
                {showCheck ? "Hide the app check" : "See what's in it"}
              </button>
              {showCheck && (
                <pre className="max-h-56 overflow-auto rounded-md border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-muted">{diagnostics ?? "Checking…"}</pre>
              )}
            </div>

            <p className="text-sm text-muted">Feedback becomes a public issue on GitHub, without your name. Check the note and pictures for anything private before sending.</p>
            {sent && !sent.ok && <Result ok={false}>Couldn't send it: {sent.message} You can open it on GitHub instead.</Result>}
            {note && <Result ok>{note}</Result>}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={button.ghost} disabled={!ready} onClick={() => void openGithub()} title="Opens a new issue on GitHub for you to check and submit">
                Open on GitHub instead
              </button>
              <button type="button" className={button.primary} disabled={!ready || sending} onClick={() => void send()}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
