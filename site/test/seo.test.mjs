import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, site), "utf8");

test("robots.txt points at the sitemap and keeps private pages out", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^Sitemap: https:\/\/lactic\.fit\/sitemap\.xml$/m);
  for (const path of ["/demo/", "/pair/", "/api/"]) assert.match(robots, new RegExp(`^Disallow: ${path}$`, "m"));
});

test("every sitemap page has a matching canonical link", () => {
  const urls = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(urls.length >= 3);
  const pages = { "https://lactic.fit/": "index.html", "https://lactic.fit/science": "science/index.html", "https://lactic.fit/privacy": "privacy/index.html" };
  for (const [url, file] of Object.entries(pages)) {
    assert.ok(urls.includes(url), url);
    assert.match(read(file), new RegExp(`<link rel="canonical" href="${url}">`));
  }
});

test("the homepage's structured data is valid JSON describing a free app", () => {
  const json = read("index.html").match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const app = JSON.parse(json)["@graph"].find((n) => n["@type"] === "SoftwareApplication");
  assert.equal(app.name, "Lactic");
  assert.equal(app.offers.price, "0");
});

test("llms.txt starts with the name and a summary", () => {
  assert.match(read("llms.txt"), /^# Lactic\n\n> .+cycling training app/);
});
