#!/usr/bin/env node
/**
 * IndexNow push — tell IndexNow-participating search engines (Bing, etc.)
 * that /sitemap.xml's URLs may have changed, instead of waiting on their own
 * crawl schedule. Read-only against the sitemap host (GET), one outbound
 * POST per batch to api.indexnow.org — never touches this app's own data.
 *
 * KEY — IndexNow's ownership proof: a random key served, verbatim, at
 * https://<host>/<key>.txt. Generated once via `openssl rand -hex 16` and
 * committed as public/<key>.txt. This script reads the key back from that
 * file by default (matched on the IndexNow key SHAPE — 32 hex chars — not a
 * hardcoded filename), so a future re-generated key needs no code change
 * here; --key overrides for a one-off run against a different key.
 *
 * USAGE
 *   node scripts/indexnow-push.mjs --dry-run
 *   node scripts/indexnow-push.mjs [--sitemap URL] [--key KEY] [--key-location URL]
 *   node scripts/indexnow-push.mjs --help
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

const HELP = `IndexNow push — POST /sitemap.xml's URLs to api.indexnow.org.

Usage: node scripts/indexnow-push.mjs [--sitemap URL] [--key KEY] [--key-location URL] [--dry-run]
       node scripts/indexnow-push.mjs --help

--sitemap        Sitemap to read (default https://intervuhq.com/sitemap.xml)
--key            IndexNow key. Default: the sole 32-hex-char public/<key>.txt.
--key-location   Where the key is served (default https://<sitemap host>/<key>.txt)
--dry-run        Print batch counts, make no network POST.`;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i !== -1 ? process.argv[i + 1] : undefined;
  return v !== undefined ? v : fallback;
};
const dryRun = process.argv.includes("--dry-run");

const KEY_FILENAME_RE = /^[0-9a-f]{32}\.txt$/;

/** The key: --key if given, else the one public/<32-hex>.txt IndexNow
 *  verification file. Matched on shape, not a hardcoded filename, so a
 *  regenerated key needs no edit here — but ambiguity (zero or multiple
 *  candidates) fails loudly instead of guessing which one. */
export function resolveKey(explicit, publicDir) {
  if (explicit) return explicit;
  const candidates = readdirSync(publicDir).filter((f) => KEY_FILENAME_RE.test(f));
  if (candidates.length === 0) {
    throw new Error(
      `No IndexNow key file found in ${publicDir} (expected a 32-hex-char <key>.txt) and no --key given.`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(`Multiple IndexNow key files in ${publicDir} (${candidates.join(", ")}) — pass --key explicitly.`);
  }
  return readFileSync(join(publicDir, candidates[0]), "utf8").trim();
}

/**
 * Pure: sitemap XML -> the <loc> URLs it lists, in document order. Uses the
 * repo's existing `cheerio` dependency in xmlMode (same import shape as
 * src/actions/fetch-url.ts) rather than a hand-rolled regex, so entity
 * decoding (&amp; etc.) comes for free.
 *
 * Reads the document literally: a <sitemapindex> pointing at further
 * sitemaps is out of scope today — this app's /sitemap.xml is a single flat
 * file (~44k URLs), well under the ~50k point a real index split would force.
 */
export function extractSitemapUrls(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
}

/** IndexNow's own per-request cap on `urlList`, and this script's batch
 *  size, so every batch short of it is legible as full without a second
 *  check. Pure so batching is unit-testable without a fetch. */
export const INDEXNOW_BATCH_SIZE = 10000;

export function batchUrls(urls, size = INDEXNOW_BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < urls.length; i += size) batches.push(urls.slice(i, i + size));
  return batches;
}

async function main() {
  const sitemapUrl = argValue("sitemap", "https://intervuhq.com/sitemap.xml");
  const host = new URL(sitemapUrl).hostname;
  const key = resolveKey(argValue("key"), join(repoRoot, "public"));
  const keyLocation = argValue("key-location", `https://${host}/${key}.txt`);

  const sitemapRes = await fetch(sitemapUrl);
  if (!sitemapRes.ok) {
    console.error(`Failed to fetch sitemap ${sitemapUrl}: HTTP ${sitemapRes.status}`);
    process.exit(1);
  }
  const urls = extractSitemapUrls(await sitemapRes.text());
  const batches = batchUrls(urls);

  console.log(`${sitemapUrl}: ${urls.length} URL(s) in ${batches.length} batch(es) of <=${INDEXNOW_BATCH_SIZE}`);

  if (dryRun) {
    console.log("--dry-run: no POST made.");
    return;
  }

  let failed = 0;
  for (const [i, urlList] of batches.entries()) {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    });
    console.log(`batch ${i + 1}/${batches.length} (${urlList.length} URLs): HTTP ${res.status}`);
    if (res.status !== 200 && res.status !== 202) failed += 1;
  }

  if (failed > 0) {
    console.error(`${failed}/${batches.length} batch(es) returned neither 200 nor 202.`);
    process.exit(1);
  }
}

// Only run when executed directly (`node scripts/indexnow-push.mjs ...`) —
// not when another module imports the pure exports above (unit tests), which
// must never have the side effect of fetching a sitemap or POSTing to
// IndexNow just by importing this file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
