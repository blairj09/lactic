// Reads attachments on the server: downloads each from Storage and turns it into text the coach can
// read (attachments.ts). Images, and PDFs without a text layer, go to a vision model once.

import { decodeFit } from "../fit/decode";
import { rideFromFit } from "../fit/ride";
import type { Athlete } from "../activities";
import type { createClient } from "../supabase/server";
import { ATTACHMENT_BUCKET, IMAGE_TYPES, MAX_ATTACHMENT_BYTES, clip, describeGpx, describeRide, type Attachment } from "./attachments";
import { openRouterLook, type ContentPart } from "./openrouter";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A cheap model that reads images and PDFs well. The coach itself (Kimi K2) reads text only. */
export const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";

export function visionModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  return apiKey ? { apiKey, model: process.env.OPENROUTER_VISION_MODEL || DEFAULT_VISION_MODEL } : null;
}

const LOOK = `You read images and documents for a cycling coach, who can't see them. The coach's athlete attached this to a chat message. Write down what it shows so the coach can answer from your words alone.
- Transcribe every number, label, unit, date and line of text exactly as shown. Don't round, estimate or work anything out.
- Charts and graphs: say what's plotted, the axes and units, the values you can read, and the shape (peaks, trends, intervals).
- Screenshots of apps (Zwift, Strava, TrainingPeaks, Garmin, Apple Health, a training plan): name the app and screen if you can tell, then the data.
- Photos: describe what matters for training or health (a bike setup, an injury, food, a route sign). Plain words, no diagnosis.
- Say what you can't read. Don't give advice or opinions. Plain text, no headings.`;

/** Reads each attachment; one that fails gets a note instead of text, so the message still goes through. */
export async function readAttachments(supabase: Supabase, attachments: Attachment[], athlete: Athlete, message: string, onStatus?: (text: string) => void): Promise<Attachment[]> {
  if (attachments.length) onStatus?.(attachments.some((a) => a.kind === "image") ? "Looking at what you attached" : "Reading what you attached");
  return Promise.all(
    attachments.map(async (a) => {
      try {
        return { ...a, text: clip(await readOne(supabase, a, athlete, message)) };
      } catch (e) {
        console.error(`Couldn't read attachment ${a.path}`, e);
        return { ...a, note: `Couldn't read this file: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
      }
    }),
  );
}

async function readOne(supabase: Supabase, a: Attachment, athlete: Athlete, message: string): Promise<string> {
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).download(a.path);
  if (error || !data) throw new Error(error?.message || "it isn't in storage");
  if (data.size > MAX_ATTACHMENT_BYTES) throw new Error("it's larger than 20 MB");
  const bytes = new Uint8Array(await data.arrayBuffer());
  switch (a.kind) {
    case "image": {
      const type = IMAGE_TYPES.includes(data.type) ? data.type : IMAGE_TYPES.includes(a.type) ? a.type : null;
      if (!type) throw new Error("this image format can't be read (use PNG, JPEG, WebP or GIF)");
      return look(message, a, { type: "image_url", image_url: { url: dataUrl(type, bytes) } });
    }
    case "pdf": {
      const text = await pdfText(bytes).catch(() => "");
      // A scan or a PDF of images has no text layer; the vision model reads the pages instead.
      if (text.replace(/\s+/g, "").length >= 200) return text;
      return look(message, a, { type: "file", file: { filename: a.name, file_data: dataUrl("application/pdf", bytes) } });
    }
    case "fit": {
      const ride = rideFromFit(decodeFit(bytes), a.name);
      return describeRide(ride, athlete.ftp, athlete.thresholdHr);
    }
    case "gpx": {
      const xml = new TextDecoder().decode(bytes);
      const route = describeGpx(xml);
      if (!route) throw new Error("no track points in this GPX file");
      return route;
    }
    case "text":
      return new TextDecoder().decode(bytes);
  }
}

async function look(message: string, a: Attachment, part: ContentPart) {
  const vision = visionModel();
  if (!vision) throw new Error("the coach needs OPENROUTER_API_KEY");
  const context = message.trim() ? `The athlete's message with it: "${message.trim().slice(0, 1000)}"` : "The athlete sent it without a message.";
  return openRouterLook(vision.apiKey, vision.model, LOOK, [{ type: "text", text: `${context}\nFile: ${a.name}` }, part], { maxTokens: 2000 });
}

async function pdfText(bytes: Uint8Array) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

const dataUrl = (type: string, bytes: Uint8Array) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

/** Links to open each attachment for an hour, for the drawer. The text the coach read stays on the server. */
export async function withLinks<T extends { attachments?: Attachment[] | null }>(supabase: Supabase, messages: T[]): Promise<T[]> {
  const paths = messages.flatMap((m) => m.attachments?.map((a) => a.path) ?? []);
  if (!paths.length) return messages;
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, 3600);
  if (error) console.error(error);
  const links = new Map((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
  return messages.map((m) =>
    m.attachments?.length ? { ...m, attachments: m.attachments.map((a) => ({ ...a, text: undefined, url: links.get(a.path) ?? undefined })) } : m,
  );
}
