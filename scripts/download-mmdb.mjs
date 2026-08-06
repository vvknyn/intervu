#!/usr/bin/env node
/**
 * Deploy-time download for the IP -> country database
 * (lib/geo/ip-country.ts). NOT run automatically by `npm run build` or the
 * Docker image — wire this into the deploy pipeline (a Dockerfile RUN step
 * or a compose entrypoint, box-side) so `data/geo/dbip-country-lite.mmdb`
 * exists before the app starts. The app fails OPEN with no mmdb present
 * (lib/geo/ip-country.ts's `createMmdbCountryLookup` — a missing file just
 * means the IP-default feature does nothing), so this is safe to skip in
 * dev; only production IP defaulting needs it.
 *
 * Source: db-ip.com's free "country lite" database (CC BY 4.0, no account
 * or API key — https://db-ip.com/db/download/ip-to-country-lite). Refreshed
 * monthly; re-run this script periodically (e.g. once a month, box cron) to
 * pick up the new release. Never commit the downloaded file — see
 * .gitignore.
 *
 *   node scripts/download-mmdb.mjs
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(here, "..", "data", "geo", "dbip-country-lite.mmdb");

function monthStamp(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchGz(stamp) {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${stamp}.mmdb.gz`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res;
}

async function main() {
  // db-ip publishes each month's file a few days into that month — the
  // current month's release may not exist yet, so fall back one month.
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const res = (await fetchGz(monthStamp(now))) ?? (await fetchGz(monthStamp(lastMonth)));
  if (!res) throw new Error("Could not find a db-ip country-lite release for this month or last month.");

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), zlib.createGunzip(), createWriteStream(OUT_PATH));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
