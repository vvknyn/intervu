#!/usr/bin/env node
/**
 * Builds the committed continent-membership artifact (data/geo/regions.json)
 * that src/lib/geo/regions.ts loads to resolve region/business-area location
 * phrases ("North America", "EMEA", "APAC", ...) — see that file for the
 * curated alias table built on top of this raw membership data.
 *
 * Source: GeoNames.org (CC BY 4.0 — https://www.geonames.org/), the same
 * countryInfo.txt dump scripts/build-gazetteer.mjs uses for country
 * name/ISO codes, here read for its continent column instead:
 *   ISO(0) ISO3(1) ISO-Numeric(2) fips(3) Country(4) Capital(5) Area(6)
 *   Population(7) Continent(8) ...
 * Continent(8) is one of: AF, AS, EU, NA, OC, SA, AN (GeoNames' own codes).
 *
 * Usage:
 *   node scripts/build-geo-regions.mjs
 *
 * If GeoNames is unreachable (offline sandbox, etc.), this script falls back
 * to a hand-authored ISO-3166 continent assignment (FALLBACK_CONTINENTS
 * below) covering every country already present in data/geo/gazetteer.json,
 * so the artifact can still be regenerated deterministically without
 * network access. Re-run against the network when possible to pick up any
 * GeoNames corrections/additions.
 *
 * Attribution: this data is © GeoNames contributors, licensed CC BY 4.0.
 * See README.md's "Location data" section.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const OUT_PATH = join(repoRoot, "data", "geo", "regions.json");
const GAZETTEER_PATH = join(repoRoot, "data", "geo", "gazetteer.json");

const COUNTRY_URL = "https://download.geonames.org/export/dump/countryInfo.txt";
const CONTINENT_CODES = new Set(["AF", "AS", "EU", "NA", "OC", "SA", "AN"]);

function parseTsv(text) {
  return text
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

// Hand-authored ISO-3166 continent assignment, used ONLY when GeoNames can't
// be reached. Covers every ISO2 in the committed gazetteer as of this
// writing. Keep in sync manually if that ever falls short — the network
// path above is authoritative and should be preferred whenever reachable.
const FALLBACK_CONTINENTS = {
  AF: [
    "DZ","AO","BJ","BW","BF","BI","CM","CV","CF","TD","KM","CG","CD","CI","DJ","EG","GQ","ER","SZ","ET",
    "GA","GM","GH","GN","GW","KE","LS","LR","LY","MG","MW","ML","MR","MU","YT","MA","MZ","NA","NE","NG",
    "RE","RW","SH","ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","EH","ZM","ZW",
  ],
  AS: [
    "AF","AM","AZ","BH","BD","BT","BN","KH","CN","CY","GE","HK","IN","ID","IR","IQ","IL","JP","JO","KZ",
    "KP","KR","KW","KG","LA","LB","MO","MY","MV","MN","MM","NP","OM","PK","PS","PH","QA","SA","SG","LK",
    "SY","TW","TJ","TH","TL","TR","TM","AE","UZ","VN","YE",
  ],
  EU: [
    "AL","AD","AT","BY","BE","BA","BG","HR","CY","CZ","DK","EE","FO","FI","FR","DE","GI","GR","GG","HU",
    "IS","IE","IM","IT","JE","XK","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO",
    "RU","SM","RS","SK","SI","ES","SJ","SE","CH","UA","GB","VA",
  ],
  NA: [
    "AI","AG","AW","BS","BB","BZ","BM","BQ","VG","CA","KY","CR","CU","CW","DM","DO","SV","GL","GD","GP",
    "GT","HT","HN","JM","MQ","MX","MS","NI","PA","PR","BL","KN","LC","MF","PM","VC","SX","TT","TC","US",
    "VI",
  ],
  OC: [
    "AS","AU","CK","FJ","PF","GU","KI","MH","FM","NR","NC","NZ","NU","NF","MP","PW","PG","PN","WS","SB",
    "TK","TO","TV","VU","WF",
  ],
  SA: ["AR","BO","BR","CL","CO","EC","FK","GF","GY","PY","PE","SR","UY","VE"],
  AN: ["AQ","BV","TF","HM","GS"],
};

async function fetchGeoNames() {
  const res = await fetch(COUNTRY_URL);
  if (!res.ok) throw new Error(`GET ${COUNTRY_URL} -> ${res.status}`);
  const rows = parseTsv(await res.text());
  const byContinent = {};
  for (const code of CONTINENT_CODES) byContinent[code] = [];
  for (const row of rows) {
    const iso2 = row[0];
    const continent = row[8];
    if (!iso2 || !CONTINENT_CODES.has(continent)) continue;
    byContinent[continent].push(iso2);
  }
  return { byContinent, source: "GeoNames.org (CC BY 4.0): countryInfo.txt, continent column" };
}

function fallbackContinents() {
  const byContinent = {};
  for (const code of CONTINENT_CODES) byContinent[code] = [...(FALLBACK_CONTINENTS[code] ?? [])];
  return {
    byContinent,
    source: "Hand-authored ISO-3166 continent assignment (GeoNames unreachable at build time)",
  };
}

async function main() {
  let result;
  try {
    console.log("Downloading GeoNames countryInfo.txt...");
    result = await fetchGeoNames();
  } catch (e) {
    console.warn(`GeoNames fetch failed (${e.message}); using the hand-authored fallback.`);
    result = fallbackContinents();
  }

  // Sanity check against the committed gazetteer, when present: every
  // country the app can actually resolve should land in exactly one
  // continent, or region resolution silently loses members.
  try {
    const gazetteer = JSON.parse(readFileSync(GAZETTEER_PATH, "utf8"));
    const known = new Set((gazetteer.countries ?? []).map((c) => c[0]));
    const placed = new Set(Object.values(result.byContinent).flat());
    const missing = [...known].filter((iso2) => !placed.has(iso2));
    if (missing.length > 0) {
      console.warn(`Warning: ${missing.length} gazetteer countries have no continent: ${missing.join(", ")}`);
    }
  } catch {
    // gazetteer.json not present/parseable — nothing to cross-check against.
  }

  for (const code of CONTINENT_CODES) result.byContinent[code].sort();

  const artifact = {
    generatedAt: new Date().toISOString(),
    source: result.source,
    // continent code -> ISO2[] (GeoNames' own AF/AS/EU/NA/OC/SA/AN codes)
    continents: result.byContinent,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2) + "\n");
  const counts = CONTINENT_CODES.size;
  const total = Object.values(result.byContinent).reduce((n, arr) => n + arr.length, 0);
  console.log(`Wrote ${OUT_PATH}: ${counts} continents, ${total} countries total`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
