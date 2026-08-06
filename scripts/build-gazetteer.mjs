#!/usr/bin/env node
/**
 * Builds the committed gazetteer artifact (data/geo/gazetteer.json) that
 * src/lib/geo/gazetteer.ts loads at runtime to back place resolution
 * (query-understanding.ts) — city/admin1/country matching + radius-neighbor
 * expansion, replacing exact-string matching against the (capped, corpus-
 * poisoned) Meilisearch facet vocabulary.
 *
 * Source: GeoNames.org (CC BY 4.0 — https://www.geonames.org/), three free
 * dumps, downloaded fresh each run (nothing here is committed as input):
 *   - cities5000.zip        every city with population >= 5000, OR a
 *                            country/admin1 seat regardless of population
 *   - admin1CodesASCII.txt  "CC.admin1code" -> region name (states/provinces)
 *   - countryInfo.txt       ISO2 / ISO3 / country name
 *
 * Usage:
 *   node scripts/build-gazetteer.mjs
 *
 * Re-run whenever the gazetteer should refresh against GeoNames' latest
 * dumps (they update roughly weekly) — the OUTPUT is committed, this script
 * is not part of the app's build or runtime path.
 *
 * Attribution: this data is © GeoNames contributors, licensed CC BY 4.0.
 * See README.md's "Location data" section.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const OUT_PATH = join(repoRoot, "data", "geo", "gazetteer.json");

const CITIES_ZIP_URL = "https://download.geonames.org/export/dump/cities5000.zip";
const ADMIN1_URL = "https://download.geonames.org/export/dump/admin1CodesASCII.txt";
const COUNTRY_URL = "https://download.geonames.org/export/dump/countryInfo.txt";

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Round to keep ~11m precision (5 decimal places) without carrying float noise into the artifact. */
function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function parseTsv(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), "gazetteer-build-"));
  try {
    console.log("Downloading GeoNames dumps...");
    const [citiesZip, admin1Raw, countryRaw] = await Promise.all([
      download(CITIES_ZIP_URL),
      download(ADMIN1_URL),
      download(COUNTRY_URL),
    ]);

    const zipPath = join(work, "cities5000.zip");
    writeFileSync(zipPath, citiesZip);
    execFileSync("unzip", ["-o", "-q", zipPath, "-d", work]);
    const citiesText = readFileSync(join(work, "cities5000.txt"), "utf8");

    // countryInfo.txt: ISO(0) ISO3(1) ISO-Numeric(2) fips(3) Country(4) ...
    const countries = parseTsv(countryRaw.toString("utf8"))
      .filter((c) => c[0] && c[1] && c[4])
      .map((c) => [c[0], c[1], c[4]]);

    // admin1CodesASCII.txt: "CC.code"(0) name(1) asciiName(2) geonameid(3)
    const admin1 = parseTsv(admin1Raw.toString("utf8"))
      .filter((a) => a[0]?.includes("."))
      .map((a) => {
        const [countryCode, admin1Code] = a[0].split(".");
        return [countryCode, admin1Code, a[2] || a[1]];
      });

    // cities5000.txt: geonameid(0) name(1) asciiname(2) alternatenames(3)
    // latitude(4) longitude(5) featureClass(6) featureCode(7) countryCode(8)
    // cc2(9) admin1Code(10) admin2Code(11) admin3Code(12) admin4Code(13)
    // population(14) elevation(15) dem(16) timezone(17) modDate(18)
    const cities = parseTsv(citiesText)
      .filter((c) => c[1] && c[8] && c[4] && c[5])
      .map((c) => [
        c[2] || c[1], // asciiname (falls back to name) — this is the primary
        // matching key: corpus location text is plain ASCII, and GeoNames'
        // "name" column can carry diacritics asciiname already strips.
        c[1] !== c[2] ? c[1] : null, // native name, only when it differs
        round5(Number(c[4])),
        round5(Number(c[5])),
        c[8], // country code
        c[10] || null, // admin1 code
        Number(c[14]) || 0, // population
      ]);

    const artifact = {
      generatedAt: new Date().toISOString(),
      source: "GeoNames.org (CC BY 4.0): cities5000 + admin1CodesASCII + countryInfo",
      countries, // [iso2, iso3, name][]
      admin1, // [countryCode, admin1Code, name][]
      cities, // [asciiName, nativeNameOrNull, lat, lng, countryCode, admin1Code|null, population][]
    };

    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(artifact));
    const sizeMb = (Buffer.byteLength(JSON.stringify(artifact)) / 1e6).toFixed(2);
    console.log(
      `Wrote ${OUT_PATH}: ${countries.length} countries, ${admin1.length} admin1 regions, ` +
        `${cities.length} cities (${sizeMb} MB)`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
