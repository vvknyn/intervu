/**
 * Builds the job title neighbour map (src/lib/jobs/title-map.ts) from O*NET, ESCO, the official
 * ESCO to O*NET-SOC crosswalk and, when given, the links learned from Velai's postings.
 *
 *   npx tsx scripts/build-title-map.ts <work-dir> [out.json] [postings-links.json] [--skip-esco]
 *
 * With postings links it also writes the search's table of roles next to each posting title
 * (title-neighbours.json beside out.json; rules in scripts/title-map/search-table.ts).
 *
 * Files missing from <work-dir> are downloaded (O*NET zip and crosswalk: one GET each; ESCO: one API
 * request per occupation, cached as JSON lines so a stopped run resumes). Downloads are untrusted
 * data: unzip only streams their text out, nothing is run. Prints what it built and the thresholds.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TitleSourceMeta } from "../src/lib/jobs/title-aliases";
import { assembleTitleMap, THRESHOLDS, type PostingLinks } from "./title-map/graph";
import { searchNeighbourTable } from "./title-map/search-table";
import { fetchEsco, parseCrosswalk, parseOnet, parseXlsxSheet, readEscoCache } from "./title-map/sources";

const ONET_VERSION = "31.0";
const ONET_ZIP = { name: "onet-db_31_0_text.zip", url: "https://www.onetcenter.org/dl_files/database/db_31_0_text.zip" };
const CROSSWALK = { name: "onet-ESCO_to_ONET-SOC.xlsx", url: "https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx" };
const ESCO_CACHE = { name: "esco-occupations.jsonl", url: "https://ec.europa.eu/esco/api/resource/occupation" };

async function download(dir: string, file: { name: string; url: string }): Promise<string> {
  const path = join(dir, file.name);
  if (!existsSync(path)) {
    const res = await fetch(file.url, { headers: { "User-Agent": "VelaiTitleMapBuilder/1.0 (https://velai.app)" } });
    if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return path;
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** One member of a zip as text (unzip -p streams it; nothing is extracted or run). */
function zipText(zip: string, member: string): string {
  return execFileSync("unzip", ["-p", zip, member], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
}

function zipMembers(zip: string): string[] {
  return execFileSync("unzip", ["-Z1", zip], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\n").filter(Boolean);
}

function onetMember(members: string[], file: string): string {
  const hit = members.find((m) => m.endsWith(`/${file}`) || m === file);
  if (!hit) throw new Error(`O*NET zip has no ${file}`);
  return hit;
}

async function main() {
  const skipEsco = process.argv.includes("--skip-esco");
  const [workDir, outArg, postingsArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!workDir) throw new Error("usage: build-title-map.ts <work-dir> [out.json] [postings-links.json] [--skip-esco]");
  mkdirSync(workDir, { recursive: true });
  const log = (s: string) => console.error(s);

  const onetZip = await download(workDir, ONET_ZIP);
  const members = zipMembers(onetZip);
  const onet = parseOnet({
    occupations: zipText(onetZip, onetMember(members, "Occupation Data.txt")),
    jobTitles: zipText(onetZip, onetMember(members, "Job Titles.txt")),
    reportedTitles: zipText(onetZip, onetMember(members, "Sample of Reported Titles.txt")),
    related: zipText(onetZip, onetMember(members, "Related Occupations.txt")),
    tasksToDwas: zipText(onetZip, onetMember(members, "Tasks to DWAs.txt")),
    software: zipText(onetZip, onetMember(members, "Software Skills.txt")),
  });

  const crosswalkXlsx = await download(workDir, CROSSWALK);
  const crosswalk = parseCrosswalk(parseXlsxSheet(zipText(crosswalkXlsx, "xl/sharedStrings.xml"), zipText(crosswalkXlsx, "xl/worksheets/sheet1.xml")));

  // --skip-esco builds from O*NET alone (for when the ESCO API cannot be reached); the sources list then has no ESCO entry.
  const escoCache = join(workDir, ESCO_CACHE.name);
  const fetched = skipEsco ? { requests: 0, occupations: 0, failed: [] as string[] } : await fetchEsco(escoCache, { log });
  const esco = skipEsco ? [] : readEscoCache(escoCache);

  const postings: PostingLinks | undefined = postingsArg ? JSON.parse(readFileSync(postingsArg, "utf8")) : undefined;

  const fetchedOn = new Date().toISOString().slice(0, 10);
  const sources: TitleSourceMeta[] = [
    {
      id: "onet",
      label: `O*NET ${ONET_VERSION} Database (U.S. Department of Labor, Employment and Training Administration)`,
      version: ONET_VERSION,
      license: "CC BY 4.0",
      files: [ONET_ZIP, CROSSWALK].map((f) => ({ name: f.name, url: f.url, sha256: sha256(join(workDir, f.name)) })),
    },
    ...(skipEsco ? [] : [{
      id: "esco",
      label: "ESCO classification (European Commission), web-service API",
      version: `API as served ${fetchedOn}`,
      license: "Reuse for any purpose with acknowledgment (Commission Decision 2011/833/EU)",
      files: [{ name: ESCO_CACHE.name, url: ESCO_CACHE.url, sha256: sha256(escoCache) }],
    }]),
    ...(postings && postingsArg
      ? [{ id: "postings", label: "Titles and terms learned from Velai's job index", version: postings.generatedAt, license: "Velai", files: [{ name: "postings-links.json", url: "local", sha256: sha256(postingsArg) }] }]
      : []),
  ];

  const map = assembleTitleMap({ sources, esco, onet, crosswalk, postings });
  const here = fileURLToPath(new URL(".", import.meta.url));
  const out = resolve(outArg ?? join(here, "../src/lib/jobs/data/title-map.json"));
  const json = JSON.stringify(map) + "\n";
  writeFileSync(out, json);
  const table = postings ? searchNeighbourTable(map, postings.generatedAt) : undefined;
  const tableOut = join(dirname(out), "title-neighbours.json");
  if (table) writeFileSync(tableOut, JSON.stringify(table) + "\n");

  const bySource = new Map<string, number>();
  for (const r of map.roles) bySource.set(r.id.split(":")[0], (bySource.get(r.id.split(":")[0]) ?? 0) + 1);
  const byKind = new Map<string, number>();
  const linked = new Set<number>();
  for (const [a, b, , k] of map.links) {
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
    linked.add(a);
    linked.add(b);
  }
  console.log(
    JSON.stringify(
      {
        out,
        bytes: json.length,
        esco: { occupations: esco.length, requests: fetched.requests, leftOut: fetched.failed },
        onet: { occupations: onet.occupations.length, related: onet.related.length, titles: onet.occupations.reduce((n, o) => n + o.titles.length, 0) },
        crosswalkPairs: crosswalk.length,
        roles: Object.fromEntries(bySource),
        links: Object.fromEntries(byKind),
        rolesWithoutLinks: map.roles.length - linked.size,
        names: map.roles.reduce((n, r) => n + r.names.length, 0),
        thresholds: THRESHOLDS,
        searchTable: table ? { out: tableOut, titles: Object.keys(table.titles).length, neighbours: Object.values(table.titles).reduce((n, t) => n + t.length, 0) } : null,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
