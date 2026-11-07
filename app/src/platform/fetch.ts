// fetch for the desktop app. Three kinds of request:
// - /api/... goes to the web app's route handlers, run right here (there's no server).
// - Other sites go through the Rust core: no CORS in the way, and a `keychain:<name>` placeholder
//   in the Authorization header becomes the real key there, so keys never sit in the web layer.
// - Everything else (the app's own files) is the browser's fetch.

import { invoke, isDesktop } from "./native";
import { devSecret } from "./secrets";

type Handler = (request: Request) => Promise<Response> | Response;
type RouteModule = Record<string, Handler | unknown>;

const routes: { pattern: RegExp; load: () => Promise<RouteModule> }[] = [];

/** Serves `/api/...` paths from a route module (GET, POST... exports), as Next would. */
export function addRoute(pattern: RegExp, load: () => Promise<RouteModule>) {
  routes.push({ pattern, load });
}

const browserFetch = globalThis.fetch.bind(globalThis);
const ORIGIN = "http://lactic.local";

interface Auth {
  secret: string;
  scheme: "bearer" | "basic" | "header";
  user?: string;
  header?: string;
}

/** Finds a keychain placeholder in the headers and turns it into what the Rust core should add. */
function takeAuth(headers: Headers): Auth | undefined {
  const value = headers.get("authorization");
  if (value) {
    const bearer = value.match(/^Bearer\s+keychain:([\w.-]+)$/i);
    if (bearer) {
      headers.delete("authorization");
      return { secret: bearer[1], scheme: "bearer" };
    }
    const basic = value.match(/^Basic\s+(.+)$/i);
    if (basic) {
      try {
        const [user, pass] = atob(basic[1]).split(/:(.*)/s);
        const m = pass?.match(/^keychain:([\w.-]+)$/);
        if (m) {
          headers.delete("authorization");
          return { secret: m[1], scheme: "basic", user };
        }
      } catch {
        // Not base64: leave it.
      }
    }
  }
  for (const name of ["x-api-key", "api-key", "x-goog-api-key"]) {
    const m = headers.get(name)?.match(/^keychain:([\w.-]+)$/);
    if (m) {
      headers.delete(name);
      return { secret: m[1], scheme: "header", header: name };
    }
  }
  return undefined;
}

/** In a plain browser there's no keychain: put the development key in directly. */
function applyDevAuth(headers: Headers, auth: Auth) {
  const key = devSecret(auth.secret) ?? "";
  if (auth.scheme === "bearer") headers.set("authorization", `Bearer ${key}`);
  else if (auth.scheme === "basic") headers.set("authorization", `Basic ${btoa(`${auth.user ?? ""}:${key}`)}`);
  else headers.set(auth.header ?? "x-api-key", key);
}

let streamSeq = 0;

async function nativeFetch(request: Request, wantsStream: boolean): Promise<Response> {
  const headers = new Headers(request.headers);
  const auth = takeAuth(headers);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
  const headerObj: Record<string, string> = {};
  headers.forEach((v, k) => (headerObj[k] = v));
  const req = {
    url: request.url,
    method: request.method,
    headers: headerObj,
    bodyBase64: body && body.length ? bytesToBase64(body) : undefined,
    auth,
    timeoutMs: wantsStream ? undefined : 120_000,
  };
  if (wantsStream) {
    const { Channel } = await import("@tauri-apps/api/core");
    const streamId = `s${++streamSeq}`;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => (controller = c),
      cancel: () => void invoke("http_cancel", { streamId }),
    });
    const channel = new Channel<{ status?: number; headers?: Record<string, string>; chunk?: string }>();
    return new Promise<Response>((resolve, reject) => {
      let started = false;
      channel.onmessage = (m) => {
        if (m.status !== undefined) {
          started = true;
          resolve(new Response(stream, { status: m.status, headers: m.headers }));
        } else if (m.chunk !== undefined) controller.enqueue(encoder.encode(m.chunk));
      };
      invoke("http_stream", { request: { ...req, streamId }, onChunk: channel })
        .then(() => controller.close())
        .catch((e) => {
          if (!started) return reject(new TypeError(String(e)));
          try {
            controller.error(new TypeError(String(e)));
          } catch {
            // Already closed.
          }
        });
    });
  }
  const res = await invoke<{ status: number; headers: Record<string, string>; bodyBase64: string | null }>("http_request", { request: { ...req, response: "binary" } }).catch((e) => {
    throw new TypeError(String(e));
  });
  const bytes = res.bodyBase64 ? base64ToBytes(res.bodyBase64) : new Uint8Array();
  const nullBody = res.status === 204 || res.status === 304;
  return new Response(nullBody ? null : (bytes as BlobPart), { status: res.status, headers: res.headers });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function isLocal(url: URL) {
  return url.origin === location.origin || url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "tauri:" || url.hostname === "tauri.localhost" || url.hostname === "asset.localhost";
}

export async function lacticFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (raw.startsWith("/api/") || raw.startsWith(`${ORIGIN}/api/`)) {
    const url = new URL(raw, ORIGIN);
    const route = routes.find((r) => r.pattern.test(url.pathname));
    if (!route) return new Response("Not found", { status: 404 });
    const mod = await route.load();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const handler = mod[method] as Handler | undefined;
    if (typeof handler !== "function") return new Response("Method not allowed", { status: 405 });
    return handler(new Request(url, input instanceof Request ? input : init));
  }
  const url = new URL(raw, location.href);
  if (isLocal(url)) return browserFetch(input, init);
  const request = new Request(input, init);
  if (!isDesktop) {
    const headers = new Headers(request.headers);
    const auth = takeAuth(headers);
    if (auth) applyDevAuth(headers, auth);
    return browserFetch(new Request(request, { headers }));
  }
  const accept = request.headers.get("accept") ?? "";
  let wantsStream = accept.includes("text/event-stream");
  if (!wantsStream && request.method === "POST" && (request.headers.get("content-type") ?? "").includes("json")) {
    const text = await request.clone().text();
    wantsStream = /"stream"\s*:\s*true/.test(text);
  }
  return nativeFetch(request, wantsStream);
}

export function installFetch() {
  globalThis.fetch = lacticFetch as typeof fetch;
}
