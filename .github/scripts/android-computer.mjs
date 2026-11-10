// A stand-in for Lactic on the computer, for the Android smoke test (android-smoke.sh): answers
// the phone's sealed requests on port 47620 the way phone.rs does (AES-256-GCM: nonce + ciphertext
// + tag around JSON {t, kind, body}; replies {ok, body}). The emulator reaches it at 10.0.2.2.
// Writes the pairing link to $OUT/pair-url.txt and every request it opened to $OUT/requests.json.

import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.env.OUT ?? "android-smoke";
mkdirSync(out, { recursive: true });
const key = randomBytes(32);
const device = "ci-device";
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
writeFileSync(`${out}/pair-url.txt`, `https://lactic.fit/pair#v=1&d=${device}&k=${b64url(key)}&p=47620&h=10.0.2.2&n=CI%20Computer`);

const seal = (obj) => {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([nonce, body, c.getAuthTag()]);
};
const open = (buf) => {
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString());
};

const seen = [];
createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/lactic/phone") {
      res.writeHead(200).end("Lactic is here");
      return;
    }
    if (req.headers["x-lactic-device"] !== device) {
      res.writeHead(401).end();
      return;
    }
    let msg;
    try {
      msg = open(Buffer.concat(chunks));
    } catch {
      res.writeHead(400).end();
      return;
    }
    const skew = Math.abs(Date.now() - msg.t);
    seen.push({ kind: msg.kind, body: msg.body, skewMs: skew });
    writeFileSync(`${out}/requests.json`, JSON.stringify(seen, null, 2));
    const reply = skew > 10 * 60_000 ? { ok: false, error: "clock" } : msg.kind === "hello" ? { ok: true, body: { computer: "CI Computer" } } : { ok: true, body: { echo: msg.kind } };
    res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(seal(reply));
  });
}).listen(47620, "0.0.0.0", () => console.log("Stand-in computer on :47620"));
