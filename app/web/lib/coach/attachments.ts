// Files and images attached to a coach chat message, and how the coach reads them. Images go to a
// vision model once, which writes down what they show; PDFs and text files are read as text; .fit
// rides are summarized by the engine; GPX routes by their distance and climbing. What the coach read
// is kept with the message, so later turns see it without reading the file again.
// No browser or Node APIs here (the server side is attachments-server.ts).

import { rideStressFromSummary, type RideSummary } from "../engine/activity";

export const ATTACHMENT_BUCKET = "coach-attachments";
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Text the coach keeps from one file. */
export const MAX_ATTACHMENT_TEXT = 30_000;
/** Text from attachments on older messages, sent again with each new one. */
const OLDER_ATTACHMENT_TEXT = 1_500;
/** Messages from the end of the conversation whose attachments are sent in full. */
const RECENT_ATTACHMENT_MESSAGES = 6;

export type AttachmentKind = "image" | "pdf" | "fit" | "gpx" | "text";

export interface Attachment {
  /** In the bucket: {user id}/{random id}/{file name}. */
  path: string;
  name: string;
  /** MIME type, as the browser gave it. */
  type: string;
  size: number;
  kind: AttachmentKind;
  /** What the coach read from it. */
  text?: string;
  /** Why it couldn't be read, when it couldn't. */
  note?: string;
  /** A link to open it, added when messages are loaded; never stored. */
  url?: string;
}

/** Image types the vision model reads. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const TEXT_EXTENSIONS = ["txt", "md", "csv", "tsv", "json", "log", "xml", "tcx", "zwo", "erg", "mrc"];

/** For the file picker. */
export const ACCEPT = ["image/*", ".pdf", ".fit", ".gpx", ...TEXT_EXTENSIONS.map((e) => `.${e}`)].join(",");

const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

/** What kind of attachment a file is, or null when the coach can't read it. */
export function attachmentKind(name: string, type: string): AttachmentKind | null {
  const ext = extension(name);
  if (type.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"].includes(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "fit") return "fit";
  if (ext === "gpx") return "gpx";
  if (type.startsWith("text/") || TEXT_EXTENSIONS.includes(ext)) return "text";
  return null;
}

/** A file name safe for a Storage path: letters, digits, dots, dashes and underscores. */
export function safeFileName(name: string) {
  const ext = extension(name);
  const base = name.replace(/\.[^.]*$/, "").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "file";
  return ext ? `${base}.${ext}` : base;
}

/** Checks attachments sent with a message: well formed, in the athlete's own folder, and not too many. */
export function parseAttachments(value: unknown, userId: string): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const item of value.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const { path, name, type, size } = item as Record<string, unknown>;
    if (typeof path !== "string" || typeof name !== "string" || !path.startsWith(`${userId}/`) || path.includes("..") || path.length > 300) continue;
    const mime = typeof type === "string" ? type.slice(0, 100) : "";
    const kind = attachmentKind(name, mime);
    if (!kind) continue;
    out.push({ path, name: name.slice(0, 200), type: mime, size: typeof size === "number" && size > 0 ? Math.round(size) : 0, kind });
  }
  return out;
}

export function clip(text: string, max = MAX_ATTACHMENT_TEXT) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > max ? `${clean.slice(0, max)}\n[... the rest of the file was cut]` : clean;
}

const KIND_LABEL: Record<AttachmentKind, string> = {
  image: "image, described by a vision model",
  pdf: "PDF, its text",
  fit: "ride file, summarized by the engine",
  gpx: "GPX route",
  text: "text file",
};

/** One attachment as the coach reads it in the message. */
export function attachmentForModel(a: Attachment, max = MAX_ATTACHMENT_TEXT) {
  const head = `[Attached: ${a.name} (${KIND_LABEL[a.kind]})]`;
  if (!a.text) return `${head}\n${a.note ?? "Couldn't read this file."}`;
  return `${head}\n${a.text.length > max ? `${a.text.slice(0, max)}\n[... cut; the full text was in an earlier turn]` : a.text}`;
}

/** A message's text with its attachments, as the coach reads it. */
export function contentWithAttachments(content: string, attachments: Attachment[] | null | undefined, max = MAX_ATTACHMENT_TEXT) {
  if (!attachments?.length) return content;
  return [content.trim(), ...attachments.map((a) => attachmentForModel(a, max))].filter(Boolean).join("\n\n");
}

/** Conversation turns for the model: recent messages carry their attachments in full, older ones a shortened version. */
export function turnsForModel<T extends { content: string; attachments?: Attachment[] | null }>(messages: T[]): (Omit<T, "attachments"> & { content: string })[] {
  return messages.map((m, i) => {
    const recent = i >= messages.length - RECENT_ATTACHMENT_MESSAGES;
    const { attachments, ...rest } = m;
    return { ...rest, content: contentWithAttachments(m.content, attachments, recent ? MAX_ATTACHMENT_TEXT : OLDER_ATTACHMENT_TEXT) };
  });
}

/** A line for the conversation summary: which files came with a message. */
export function attachmentNames(attachments: Attachment[] | null | undefined) {
  return attachments?.length ? ` [attached: ${attachments.map((a) => a.name).join(", ")}]` : "";
}

// --- Ride files -------------------------------------------------------------------------------

const BEST_EFFORTS: [number, string][] = [
  [5, "5 s"],
  [60, "1 min"],
  [300, "5 min"],
  [1200, "20 min"],
  [3600, "60 min"],
];

const hms = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s).padStart(2, "0")}s`;
};

/** A ride file's numbers, from the engine's summary, with stress when FTP is known. */
export function describeRide(ride: { name: string; startedAt: string; distanceMeters: number | null; summary: RideSummary }, ftp: number | null, thresholdHeartRate: number | null) {
  const s = ride.summary;
  const lines = [`Ride "${ride.name}", started ${ride.startedAt}`, `Duration: ${hms(s.durationSeconds)}`];
  if (ride.distanceMeters) lines.push(`Distance: ${(ride.distanceMeters / 1000).toFixed(1)} km`);
  if (s.averagePower !== null) lines.push(`Average power: ${Math.round(s.averagePower)} W`);
  if (s.normalizedPower !== null) lines.push(`Normalized power: ${Math.round(s.normalizedPower)} W`);
  if (s.averageHeartRate !== null) lines.push(`Average heart rate: ${Math.round(s.averageHeartRate)} bpm`);
  const stress = rideStressFromSummary(s, ftp, thresholdHeartRate);
  if (stress) lines.push(`Training stress: ${Math.round(stress.trainingStress)} (intensity ${stress.intensityFactor.toFixed(2)}, from ${stress.method === "power" ? `power at FTP ${ftp} W` : "heart rate"})`);
  const best = s.powerCurve ? BEST_EFFORTS.filter(([d]) => s.powerCurve![d]).map(([d, label]) => `${label} ${Math.round(s.powerCurve![d])} W`) : [];
  if (best.length) lines.push(`Best power: ${best.join(", ")}`);
  if (s.averagePower === null && s.averageHeartRate === null) lines.push("No power or heart rate in this file.");
  return lines.join("\n");
}

// --- GPX routes -------------------------------------------------------------------------------

interface RoutePoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: string;
}

const EARTH_RADIUS = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

function meters(a: RoutePoint, b: RoutePoint) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Track (or route) points in a GPX file, read with plain text matching so it runs anywhere. */
export function gpxPoints(xml: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  const tag = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/g;
  for (const match of xml.matchAll(tag)) {
    const attrs = match[2];
    const lat = Number(attrs.match(/\blat\s*=\s*["']([-\d.eE+]+)["']/)?.[1]);
    const lng = Number(attrs.match(/\blon\s*=\s*["']([-\d.eE+]+)["']/)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const body = match[4] ?? "";
    const ele = Number(body.match(/<ele>\s*([-\d.eE+]+)\s*<\/ele>/)?.[1]);
    const time = body.match(/<time>\s*([^<]+?)\s*<\/time>/)?.[1];
    points.push({ lat, lng, ...(Number.isFinite(ele) ? { ele } : {}), ...(time ? { time } : {}) });
  }
  return points;
}

/** Climbing counts once the road has gained this much, so GPS noise doesn't add up. */
const CLIMB_THRESHOLD = 3;

/** A GPX route's distance, climbing, highest and lowest points, and time when it's a recorded ride. */
export function describeGpx(xml: string) {
  const points = gpxPoints(xml);
  if (points.length < 2) return null;
  const name = xml.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/)?.[1]?.trim();
  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += meters(points[i - 1], points[i]);
  const elevations = points.map((p) => p.ele).filter((e): e is number => e !== undefined);
  let gain = 0;
  let loss = 0;
  if (elevations.length > 1) {
    let anchor = elevations[0];
    for (const e of elevations.slice(1)) {
      if (Math.abs(e - anchor) < CLIMB_THRESHOLD) continue;
      if (e > anchor) gain += e - anchor;
      else loss += anchor - e;
      anchor = e;
    }
  }
  const lines = [`${name ? `Route "${name}"` : "Route"}: ${(distance / 1000).toFixed(1)} km, ${points.length} points`];
  if (elevations.length > 1) {
    lines.push(`Climbing: ${Math.round(gain)} m up, ${Math.round(loss)} m down; highest ${Math.round(Math.max(...elevations))} m, lowest ${Math.round(Math.min(...elevations))} m`);
  }
  const start = points[0];
  const end = points[points.length - 1];
  lines.push(`Starts at ${start.lat.toFixed(4)}, ${start.lng.toFixed(4)}; ends ${meters(start, end) < 200 ? "where it started (a loop)" : `at ${end.lat.toFixed(4)}, ${end.lng.toFixed(4)}`}`);
  const [t0, t1] = [Date.parse(start.time ?? ""), Date.parse(end.time ?? "")];
  if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) lines.push(`Recorded ${start.time}, elapsed ${hms((t1 - t0) / 1000)}`);
  // The shape of the climbing: elevation every tenth of the way, for the coach to talk about where the hills are.
  if (elevations.length === points.length) {
    const marks: string[] = [];
    let run = 0;
    let next = 0;
    for (let i = 0; i < points.length; i++) {
      if (i) run += meters(points[i - 1], points[i]);
      if (run >= next || i === points.length - 1) {
        marks.push(`${(run / 1000).toFixed(1)} km ${Math.round(points[i].ele!)} m`);
        next += distance / 10;
      }
    }
    lines.push(`Elevation along the way: ${marks.join(", ")}`);
  }
  return lines.join("\n");
}
