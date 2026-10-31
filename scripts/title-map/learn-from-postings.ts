/**
 * Learns which job titles sit next to each other from what their postings ask for, read from
 * Velai's live index. This is the layer the public classifications lack: neither O*NET nor ESCO
 * has Product Owner or Technical Account Manager as a title. A laptop job (the index is
 * tailnet-only); READ-ONLY, with the search key.
 *
 *   MEILISEARCH_HOST=... MEILISEARCH_SEARCH_KEY=... npx tsx scripts/title-map/learn-from-postings.ts [title-map.json] [out.json]
 *
 * 1. Titles: one title-only search per seed (the commonest words and word pairs of the map's role
 *    names, MAX_SEEDS), asking only for the `title` facet: up to 300 exact titles holding the seed,
 *    each with its posting count, and no posting rows. Titles are reduced to a key (rank words,
 *    team and place suffixes taken off), summed, and kept from MIN_POSTINGS up, most common first,
 *    up to MAX_TITLES.
 * 2. Terms: for each kept title, up to PER_TITLE postings (at most 3 per company, and only when
 *    MIN_COMPANIES companies are among them) read through `jdTermsFromDescription`, the same
 *    requirement and duty terms the fit score reads.
 * 3. Links: a title's vector is the share of its postings using each term times the term's IDF
 *    across titles; cosine through an inverted index; the top LINKS_PER_TITLE at or above MIN_COSINE.
 * Writes titles (key, label, counts) and links only: no posting text, no company names.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RANK_WORDS } from "../../src/lib/match/duty-signals";
import { jdTermsFromDescription } from "../../src/lib/match/jd-match";
import { normalizeTitleName } from "../../src/lib/jobs/title-aliases";
import type { TitleMap } from "../../src/lib/jobs/title-map";
import type { PostingLinks } from "./graph";

const env = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
export const PARAMS = {
  MAX_SEEDS: env("MAX_SEEDS", 3000),
  MIN_POSTINGS: env("MIN_POSTINGS", 15),
  MIN_COMPANIES: env("MIN_COMPANIES", 3),
  MAX_TITLES: env("MAX_TITLES", 2000),
  PER_TITLE: env("PER_TITLE", 15),
  PER_COMPANY: 3,
  LINKS_PER_TITLE: env("LINKS_PER_TITLE", 10),
  MIN_COSINE: env("MIN_COSINE", 0.25),
  /** A term counts for a title when at least this share of its postings use it. */
  MIN_TERM_SHARE: 0.15,
  PAUSE_MS: env("PAUSE_MS", 120),
};

const NOISE = new Set(["remote", "hybrid", "onsite", "contract", "temporary", "temp", "permanent", "full", "part", "time", "fte", "m", "f", "d", "w", "h", "x", "all", "genders"]);

/**
 * The title with its rank and its team, place or contract suffixes taken off:
 * "Senior Technical Account Manager - EMEA (Remote)" -> "technical account manager".
 */
export function titleKey(raw: string): string {
  const head = raw.split(/\s+[-–—|:]\s+|[,(\[]|\s+@\s+/)[0] ?? "";
  const words = normalizeTitleName(head)
    .split(" ")
    .filter((w) => w && !RANK_WORDS.has(w) && !NOISE.has(w) && !/^\d+$/.test(w));
  return words.length >= 1 && words.length <= 6 ? words.join(" ") : "";
}

const FILLER = new Set(["and", "the", "for", "other", "all", "except", "including", "of", "in", "to", "or"]);

/**
 * Seeds for the title harvest: the words and adjacent word pairs of the map's role names, most
 * common first, alternating so pairs ("account manager", "product owner") reach the specific titles
 * a single common word would bury under the 300-title facet cap.
 */
export function seedTerms(names: string[], max: number): string[] {
  const words = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const name of names) {
    const ws = normalizeTitleName(name)
      .split(" ")
      .filter((w) => w.length >= 2 && !RANK_WORDS.has(w) && !NOISE.has(w) && !/^\d+$/.test(w));
    for (const w of new Set(ws)) if (w.length >= 3 && !FILLER.has(w)) words.set(w, (words.get(w) ?? 0) + 1);
    for (let i = 0; i + 1 < ws.length; i++) {
      if (FILLER.has(ws[i]) || FILLER.has(ws[i + 1])) continue;
      const pair = `${ws[i]} ${ws[i + 1]}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
  const rank = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const [w, p] = [rank(words), rank(pairs)];
  const out: string[] = [];
  for (let i = 0; out.length < max && (i < w.length || i < p.length); i++) {
    if (i < p.length && out.length < max) out.push(p[i]);
    if (i < w.length && out.length < max) out.push(w[i]);
  }
  return out;
}

/** Exact titles and their posting counts (from title facets) -> counts per title key, with the commonest plain spelling. */
export function titleKeys(counts: Map<string, number>): Map<string, { postings: number; label: string }> {
  const out = new Map<string, { postings: number; label: string; best: number }>();
  for (const [raw, n] of counts) {
    const key = titleKey(raw);
    if (!key) continue;
    const e = out.get(key) ?? { postings: 0, label: "", best: -1 };
    e.postings += n;
    const plain = normalizeTitleName(raw) === key;
    if (plain && n > e.best) {
      e.best = n;
      e.label = raw.trim();
    }
    out.set(key, e);
  }
  const titleCase = (k: string) => k.replace(/\b\w/g, (c) => c.toUpperCase());
  return new Map([...out].map(([k, e]) => [k, { postings: e.postings, label: e.label || titleCase(k) }]));
}

/** Title vectors (term -> share of the title's postings) to the strongest cosine links per title. */
export function postingLinks(vectors: Map<string, Map<string, number>>, perTitle: number, minCosine: number): Array<[string, string, number]> {
  const keys = [...vectors.keys()];
  const df = new Map<string, number>();
  for (const v of vectors.values()) for (const t of v.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = keys.length;
  const inverted = new Map<string, Array<[number, number]>>();
  const weighted = keys.map((k, i) => {
    const out = new Map<string, number>();
    let sq = 0;
    for (const [t, share] of vectors.get(k)!) {
      const w = share * Math.log(n / df.get(t)!);
      if (w <= 0) continue;
      out.set(t, w);
      sq += w * w;
      const list = inverted.get(t);
      if (list) list.push([i, w]);
      else inverted.set(t, [[i, w]]);
    }
    return { out, norm: Math.sqrt(sq) };
  });
  const links: Array<[string, string, number]> = [];
  weighted.forEach(({ out, norm }, i) => {
    if (norm === 0) return;
    const dots = new Map<number, number>();
    for (const [t, w] of out) for (const [j, wj] of inverted.get(t)!) if (j !== i) dots.set(j, (dots.get(j) ?? 0) + w * wj);
    [...dots]
      .map(([j, dot]) => [j, dot / (norm * weighted[j].norm)] as const)
      .filter(([, c]) => c >= minCosine)
      .sort((a, b) => b[1] - a[1] || keys[a[0]].localeCompare(keys[b[0]]))
      .slice(0, perTitle)
      .forEach(([j, c]) => links.push([keys[i], keys[j], Math.round(c * 1000) / 1000]));
  });
  return links;
}

const HOST = (process.env.MEILISEARCH_HOST ?? process.env.MEILI_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.MEILISEARCH_SEARCH_KEY ?? process.env.MEILISEARCH_API_KEY ?? process.env.MEILI_KEY ?? process.env.MEILI_SEARCH_KEY ?? "";
const INDEX = process.env.MEILI_INDEX ?? "jobs";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

interface Hit {
  id: string;
  title?: string;
  company?: string;
  description?: string;
}

interface SearchResult {
  hits: Hit[];
  facetDistribution?: Record<string, Record<string, number>>;
}

async function search(body: Record<string, unknown>): Promise<SearchResult> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    requests++;
    const res = await fetch(`${HOST}/indexes/${INDEX}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ filter: ['vacancy_status != "closed"'], ...body }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      await sleep(PARAMS.PAUSE_MS);
      return (await res.json()) as SearchResult;
    }
    if (res.status < 500 && res.status !== 429) throw new Error(`search: HTTP ${res.status} ${await res.text()}`);
    await sleep(3_000 * attempt);
  }
  throw new Error("search: gave up after 4 attempts");
}

async function main() {
  if (!HOST || !KEY) {
    console.error("Set MEILISEARCH_HOST (or MEILI_URL) and MEILISEARCH_SEARCH_KEY. Nothing was read or written.");
    process.exit(2);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const [mapArg, outArg] = process.argv.slice(2);
  const mapPath = resolve(mapArg ?? `${here}/../../src/lib/jobs/data/title-map.json`);
  const outPath = resolve(outArg ?? (existsSync("/mnt/project-files") ? "/mnt/project-files/title-map/postings-links.json" : "postings-links.json"));
  const map = JSON.parse(readFileSync(mapPath, "utf8")) as TitleMap;

  // 1. Titles: facet counts only.
  const seeds = seedTerms(map.roles.flatMap((r) => r.names), PARAMS.MAX_SEEDS);
  const rawCounts = new Map<string, number>();
  for (const [i, seed] of seeds.entries()) {
    const { facetDistribution } = await search({ q: seed, attributesToSearchOn: ["title"], matchingStrategy: "all", limit: 0, facets: ["title"] });
    for (const [raw, n] of Object.entries(facetDistribution?.title ?? {})) rawCounts.set(raw, Math.max(rawCounts.get(raw) ?? 0, n));
    if (i % 250 === 0) console.error(`titles: ${i}/${seeds.length} seeds, ${rawCounts.size} exact titles`);
  }
  const byKey = titleKeys(rawCounts);
  const kept = [...byKey]
    .filter(([, e]) => e.postings >= PARAMS.MIN_POSTINGS)
    .sort((a, b) => b[1].postings - a[1].postings || a[0].localeCompare(b[0]))
    .slice(0, PARAMS.MAX_TITLES);

  // 2. Terms.
  const vectors = new Map<string, Map<string, number>>();
  const companies = new Map<string, number>();
  for (const [i, [key]] of kept.entries()) {
    const { hits } = await search({ q: key, attributesToSearchOn: ["title"], matchingStrategy: "all", limit: 100, attributesToRetrieve: ["id", "title", "company", "description"] });
    const perCompany = new Map<string, number>();
    const termCount = new Map<string, number>();
    let read = 0;
    for (const h of hits) {
      if (read >= PARAMS.PER_TITLE || !h.title || titleKey(h.title) !== key) continue;
      const company = (h.company ?? "").toLowerCase();
      if ((perCompany.get(company) ?? 0) >= PARAMS.PER_COMPANY) continue;
      const terms = jdTermsFromDescription(h.description, { title: h.title, company: h.company });
      if (!terms) continue;
      perCompany.set(company, (perCompany.get(company) ?? 0) + 1);
      read++;
      for (const t of new Set([...terms.req, ...terms.duty])) termCount.set(t, (termCount.get(t) ?? 0) + 1);
    }
    if (read >= 3 && perCompany.size >= PARAMS.MIN_COMPANIES) {
      const v = new Map<string, number>();
      for (const [t, c] of termCount) if (c / read >= PARAMS.MIN_TERM_SHARE) v.set(t, c / read);
      if (v.size > 0) {
        vectors.set(key, v);
        companies.set(key, perCompany.size);
      }
    }
    if (i % 100 === 0) console.error(`terms: ${i}/${kept.length} titles`);
  }

  // 3. Links.
  const links = postingLinks(vectors, PARAMS.LINKS_PER_TITLE, PARAMS.MIN_COSINE);
  const out: PostingLinks & { params: typeof PARAMS; requests: number; exactTitles: number } = {
    generatedAt: new Date().toISOString(),
    params: PARAMS,
    requests,
    exactTitles: rawCounts.size,
    titles: kept.filter(([key]) => vectors.has(key)).map(([key, e]) => ({ key, label: e.label, postings: e.postings, companies: companies.get(key) ?? 0 })),
    links,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out) + "\n");
  console.log(JSON.stringify({ out: outPath, requests, exactTitles: rawCounts.size, keys: byKey.size, kept: kept.length, withTerms: vectors.size, links: links.length }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
