"use client";

// Attaching files to a coach message in the browser: checks, shrinks big photos, and uploads each to
// Storage straight away (Vercel functions can't take large request bodies), then shows them in the
// message box and in the conversation.

import { useCallback, useEffect, useRef, useState } from "react";
import { ATTACHMENT_BUCKET, IMAGE_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, attachmentKind, safeFileName, type Attachment } from "@/lib/coach/attachments";
import { createClient } from "@/lib/supabase/client";

export interface PendingFile {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: Attachment["kind"];
  /** A local link to show an image before it's sent. */
  preview?: string;
  status: "uploading" | "ready" | "error";
  path?: string;
  error?: string;
}

/** Photos are shrunk to this many pixels on the long side, which keeps text in screenshots readable. */
const MAX_SIDE = 2048;

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && IMAGE_TYPES.includes(file.type) && file.size < 4 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = file.type === "image/png" && scale === 1;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, png ? "image/png" : "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    // A format this browser can't draw (HEIC in Chrome): send it as it is.
    return file;
  }
}

/** The files waiting to go with the next message. */
export function useAttachments() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const count = useRef(0);
  count.current = files.length;

  const update = (id: string, change: Partial<PendingFile>) => setFiles((all) => all.map((f) => (f.id === id ? { ...f, ...change } : f)));

  const add = useCallback(async (list: FileList | File[]) => {
    setProblem(null);
    const incoming = Array.from(list);
    const room = MAX_ATTACHMENTS - count.current;
    if (incoming.length > room) setProblem(`Up to ${MAX_ATTACHMENTS} files a message.`);
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return setProblem("Sign in again to attach files.");
    for (const file of incoming.slice(0, Math.max(0, room))) {
      const kind = attachmentKind(file.name, file.type);
      if (!kind) {
        setProblem(`The coach can't read ${file.name}. Attach images, PDFs, .fit, .gpx or text files.`);
        continue;
      }
      const id = crypto.randomUUID();
      const blob = kind === "image" ? await shrink(file) : file;
      if (blob.size > MAX_ATTACHMENT_BYTES) {
        setProblem(`${file.name} is over 20 MB.`);
        continue;
      }
      const type = blob.type || file.type;
      const name = kind === "image" && type === "image/jpeg" && !/\.jpe?g$/i.test(file.name) ? `${file.name.replace(/\.[^.]*$/, "")}.jpg` : file.name;
      const preview = kind === "image" ? URL.createObjectURL(blob) : undefined;
      count.current += 1;
      setFiles((all) => [...all, { id, name, type, size: blob.size, kind, preview, status: "uploading" }]);
      const path = `${userId}/${id}/${safeFileName(name)}`;
      const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, blob, { contentType: type || "application/octet-stream" });
      update(id, error ? { status: "error", error: error.message } : { status: "ready", path });
    }
  }, []);

  const remove = (id: string) => setFiles((all) => all.filter((f) => f.id !== id));
  const clear = () => setFiles([]);
  const uploading = files.some((f) => f.status === "uploading");
  /** What goes with the message: the uploaded files. */
  const ready = files.filter((f) => f.status === "ready" && f.path).map((f) => ({ path: f.path!, name: f.name, type: f.type, size: f.size, kind: f.kind, url: f.preview }));
  return { files, add, remove, clear, uploading, ready, problem, setProblem };
}

/** Drop files anywhere on `target` to attach them. Returns whether files are being dragged over it. */
export function useDropFiles(onFiles: (files: FileList) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    if (!over) depth.current = 0;
  }, [over]);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (hasFiles(e)) e.preventDefault();
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        depth.current -= 1;
        if (depth.current <= 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      },
    },
  };
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

/** The files waiting in the message box, each with a remove button. */
export function PendingFiles({ files, onRemove }: { files: PendingFile[]; onRemove: (id: string) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attached files">
      {files.map((f) => (
        <li key={f.id} className={`relative flex h-14 items-center gap-2 overflow-hidden rounded-md border bg-surface text-sm ${f.status === "error" ? "border-negative" : "border-control"} ${f.preview ? "w-14" : "max-w-[14rem] pr-8 pl-2.5"}`}>
          {f.preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.preview} alt={f.name} className={`size-full object-cover ${f.status === "uploading" ? "opacity-50" : ""}`} />
          ) : (
            <>
              <FileIcon />
              <span className="min-w-0">
                <span className="block truncate">{f.name}</span>
                <span className={`block text-xs ${f.status === "error" ? "text-negative" : "text-muted"}`}>{f.status === "error" ? "Upload failed" : f.status === "uploading" ? "Uploading..." : size(f.size)}</span>
              </span>
            </>
          )}
          {f.preview && f.status === "uploading" && <span className="absolute inset-0 grid animate-pulse place-items-center text-[10px] text-ink">Uploading</span>}
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            title={f.error ?? `Remove ${f.name}`}
            onClick={() => onRemove(f.id)}
            className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-ground/90 text-muted shadow hover:text-ink"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Attachments on a message in the conversation: images as thumbnails, other files as chips. Each opens in a new tab. */
export function MessageAttachments({ attachments }: { attachments: Attachment[] }) {
  const images = attachments.filter((a) => a.kind === "image" && a.url);
  const others = attachments.filter((a) => !(a.kind === "image" && a.url));
  return (
    <div className="space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((a) => (
            <a key={a.path} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line" title={a.note ?? a.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.name} className={`max-h-40 object-cover ${images.length > 1 ? "size-24" : "max-w-full"}`} />
            </a>
          ))}
        </div>
      )}
      {others.map((a) => (
        <a
          key={a.path}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          title={a.note ?? a.name}
          className="ml-auto flex w-fit max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm transition-colors hover:bg-raised"
        >
          <FileIcon />
          <span className="min-w-0 truncate">{a.name}</span>
          <span className="shrink-0 text-xs text-muted">{a.note ? "Couldn't read" : size(a.size)}</span>
        </a>
      ))}
    </div>
  );
}
