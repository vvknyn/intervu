/**
 * Readers for the title map's public sources. Downloads are untrusted data: read as text, never run.
 * Parsing is pure (string in, records out) so it is tested on fixtures; fetching lives in `fetchEsco`.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { CrosswalkPair, EscoOccupation, OnetOccupation, OnetRelated } from "./graph";

/** Tab-separated text with a header row (the O*NET text database) -> records keyed by header. */
export function parseTsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const header = (lines.shift() ?? "").split("\t").map((h) => h.trim());
  return lines.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

/** O*NET text files (31.0 names): Occupation Data, Job Titles, Sample of Reported Titles, Related Occupations. */
export function parseOnet(files: { occupations: string; jobTitles: string; reportedTitles: string; related: string; tasksToDwas?: string; software?: string }): {
  occupations: OnetOccupation[];
  related: OnetRelated[];
} {
  const titles = new Map<string, string[]>();
  const addTitle = (code: string, title: string) => {
    if (!code || !title || /^n\/a$/i.test(title)) return;
    const list = titles.get(code);
    if (list) list.push(title);
    else titles.set(code, [title]);
  };
  for (const r of parseTsv(files.jobTitles)) {
    addTitle(r["O*NET-SOC Code"], r["Job Title"] ?? r["Alternate Title"]);
    addTitle(r["O*NET-SOC Code"], r["Short Title"]);
  }
  for (const r of parseTsv(files.reportedTitles)) addTitle(r["O*NET-SOC Code"], r["Reported Job Title"]);
  const setsBy = (text: string | undefined, column: string) => {
    const out = new Map<string, Set<string>>();
    for (const r of text ? parseTsv(text) : []) {
      const code = r["O*NET-SOC Code"];
      const value = (r[column] ?? "").trim().toLowerCase();
      if (!code || !value) continue;
      (out.get(code) ?? out.set(code, new Set()).get(code)!).add(value);
    }
    return out;
  };
  const work = setsBy(files.tasksToDwas, "DWA Element ID");
  const tools = setsBy(files.software, "Workplace Example");
  const occupations = parseTsv(files.occupations)
    .filter((r) => r["O*NET-SOC Code"] && r["Title"])
    .map((r) => {
      const code = r["O*NET-SOC Code"];
      return {
        code,
        title: r["Title"],
        titles: [...new Set(titles.get(code) ?? [])],
        ...(work.has(code) ? { work: [...work.get(code)!].sort() } : {}),
        ...(tools.has(code) ? { tools: [...tools.get(code)!].sort() } : {}),
      };
    });
  const related = parseTsv(files.related)
    .filter((r) => r["O*NET-SOC Code"] && r["Related O*NET-SOC Code"])
    .map((r) => ({ code: r["O*NET-SOC Code"], related: r["Related O*NET-SOC Code"], tier: r["Relatedness Tier"], index: Number(r["Index"]) || 0 }));
  return { occupations, related };
}

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Column letters -> zero-based index ("A" -> 0, "AB" -> 27). */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first worksheet of an .xlsx, given its sharedStrings.xml and sheet1.xml, as rows of cell text. */
export function parseXlsxSheet(sharedStringsXml: string, sheetXml: string): string[][] {
  const shared = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  return [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells: string[] = [];
    for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const body = c[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const text = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? xmlText(body) : v !== undefined ? xmlText(v) : "";
      cells[ref ? columnIndex(ref) : cells.length] = text.trim();
    }
    return Array.from(cells, (x) => x ?? "");
  });
}

/**
 * ESCO to O*NET-SOC crosswalk rows. The header row is found by its cells (an ESCO code column and an
 * O*NET-SOC code column), so a reordered or retitled sheet still reads, and a sheet without them throws.
 * The sheet names ESCO occupations by their ESCO code ("2512.4"), which the ESCO API record carries as `code`.
 */
export function parseCrosswalk(rows: string[][]): CrosswalkPair[] {
  const isEsco = (c: string) => /esco/i.test(c) && /code|uri/i.test(c);
  const isOnet = (c: string) => /o\*?net/i.test(c) && /code/i.test(c);
  const at = rows.findIndex((r) => r.some(isEsco) && r.some(isOnet));
  if (at < 0) throw new Error("crosswalk: no header row with an ESCO code column and an O*NET-SOC code column");
  const escoCol = rows[at].findIndex(isEsco);
  const onetCol = rows[at].findIndex(isOnet);
  const out: CrosswalkPair[] = [];
  let esco = "";
  for (const r of rows.slice(at + 1)) {
    // A merged ESCO cell spans its O*NET rows: an empty ESCO cell continues the row above.
    esco = (r[escoCol] ?? "").trim() || esco;
    const onetCode = (r[onetCol] ?? "").trim();
    if (esco && /^\d{2}-\d{4}\.\d{2}$/.test(onetCode)) out.push({ esco, onetCode });
  }
  return out;
}

/** One ESCO API occupation record (`/resource/occupation`, English) -> the fields the map keeps. */
export function parseEscoOccupation(json: unknown): EscoOccupation | null {
  const o = json as {
    uri?: string;
    preferredLabel?: Record<string, string>;
    alternativeLabel?: Record<string, string[]>;
    code?: string;
    _links?: Record<string, unknown>;
    broaderIscoGroup?: Array<{ uri?: string; title?: string; code?: string }>;
    hasEssentialSkill?: Array<{ uri?: string }>;
    hasOptionalSkill?: Array<{ uri?: string }>;
  };
  const label = o.preferredLabel?.en;
  if (!o.uri || !label) return null;
  // Links sit at the top level in the current API and under _links in older ones.
  const pick = <T>(key: string): T[] => ((o as Record<string, unknown>)[key] ?? o._links?.[key] ?? []) as T[];
  const unit = (o.code ?? "").match(/^(\d{4})/)?.[1];
  const group = pick<{ uri?: string; title?: string }>("broaderIscoGroup").find((g) => unit && g.uri?.endsWith(`C${unit}`));
  return {
    uri: o.uri,
    ...(o.code ? { code: o.code } : {}),
    label,
    altLabels: o.alternativeLabel?.en ?? [],
    ...(unit ? { iscoUnit: unit } : {}),
    ...(group?.title ? { iscoUnitLabel: group.title } : {}),
    essential: pick<{ uri?: string }>("hasEssentialSkill").map((s) => s.uri ?? "").filter(Boolean),
    optional: pick<{ uri?: string }>("hasOptionalSkill").map((s) => s.uri ?? "").filter(Boolean),
  };
}

const ESCO_API = "https://ec.europa.eu/esco/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "VelaiTitleMapBuilder/1.0 (https://velai.app)" }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`${url}: HTTP ${res.status}`);
    await sleep(5_000 * attempt);
  }
  throw new Error(`${url}: gave up after 5 attempts`);
}

/**
 * Every ESCO occupation, one API record each, appended to `cacheFile` as JSON lines so an
 * interrupted run resumes where it stopped. Polite: one request at a time, `pauseMs` apart.
 * The search endpoint's `offset` is a page number (its own next link says offset=1 after page 0).
 */
export async function fetchEsco(
  cacheFile: string,
  opts: { pauseMs?: number; concurrency?: number; log?: (s: string) => void } = {},
): Promise<{ requests: number; occupations: number; failed: string[] }> {
  const { pauseMs = 300, concurrency = 3, log = () => {} } = opts;
  const done = new Set<string>();
  if (existsSync(cacheFile)) {
    for (const line of readFileSync(cacheFile, "utf8").split("\n")) if (line) done.add((JSON.parse(line) as { uri: string }).uri);
  }
  let requests = 0;
  const uris: string[] = [];
  const listed = new Set<string>();
  for (let page = 0; ; page++) {
    const body = (await getJson(`${ESCO_API}/search?type=occupation&language=en&limit=100&offset=${page}&full=false`)) as {
      total: number;
      _embedded?: { results?: Array<{ uri: string }> };
    };
    requests++;
    const results = body._embedded?.results ?? [];
    for (const r of results) {
      if (listed.has(r.uri)) continue;
      listed.add(r.uri);
      uris.push(r.uri);
    }
    log(`esco list page ${page}: ${uris.length}/${body.total}`);
    if (results.length === 0 || uris.length >= body.total || page > 100) break;
    await sleep(pauseMs);
  }
  // A few requests in flight at once (the API takes about 3 s per record); each record is one appended line.
  const todo = uris.filter((uri) => !done.has(uri));
  const failed: string[] = [];
  const worker = async () => {
    for (let uri = todo.shift(); uri; uri = todo.shift()) {
      // A record the API keeps failing on (one answers HTTP 500 every time) is left out and named, not fatal.
      const record = await getJson(`${ESCO_API}/resource/occupation?uri=${encodeURIComponent(uri)}&language=en`).catch((err: Error) => {
        failed.push(uri);
        log(`esco occupation left out: ${err.message}`);
        return null;
      });
      requests++;
      if (!record) continue;
      appendFileSync(cacheFile, JSON.stringify(record) + "\n");
      done.add(uri);
      if (done.size % 100 === 0) log(`esco occupations: ${done.size}/${uris.length}`);
      await sleep(pauseMs);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { requests, occupations: done.size, failed };
}

export function readEscoCache(cacheFile: string): EscoOccupation[] {
  const seen = new Map<string, EscoOccupation>();
  for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
    if (!line) continue;
    const o = parseEscoOccupation(JSON.parse(line));
    if (o) seen.set(o.uri, o);
  }
  return [...seen.values()].sort((a, b) => a.uri.localeCompare(b.uri));
}
