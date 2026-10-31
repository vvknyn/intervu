/**
 * Learns which job titles sit next to each other from what their postings ask for, read from
 * Velai's live index. This is the layer the public classifications lack: they have no Product
 * Owner, Technical Account Manager or Customer Success Manager. A laptop job (the index is
 * tailnet-only); READ-ONLY, with the search key.
 *
 *   MEILISEARCH_HOST=... MEILISEARCH_SEARCH_KEY=... npx tsx scripts/title-map/learn-from-postings.ts [title-map.json] [out.json]
 *
 * 1. Titles: one title-only search per word of the public map's role labels (most common first,
 *    MAX_WORDS), keeping each posting's id, title and company. Titles are reduced to a key (rank
 *    words, team and place suffixes taken off) and kept when MIN_POSTINGS postings at MIN_COMPANIES
 *    companies carry them, most common first, up to MAX_TITLES.
 * 2. Terms: for each kept title, up to PER_TITLE postings (at most 3 per company) read through
 *    `jdTermsFromDescription`, the same requirement and duty terms the fit score reads.
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
  MAX_WORDS: env("MAX_WORDS", 1500),
  MIN_POSTINGS: env("MIN_POSTINGS", 15),
  MIN_COMPANIES: env("MIN_COMPANIES", 5),
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

/** Words of the role labels, most common first: each one is a title-only search that surfaces the titles holding it. */
export function seedWords(labels: string[], max: number): string[] {
  const count = new Map<string, number>();
  for (const label of labels) {
    for (const w of new Set(normalizeTitleName(label).split(" "))) {
      if (w.length < 3 || RANK_WORDS.has(w) || NOISE.has(w) || /^\d+$/.test(w) || ["and", "the", "for", "other", "all"].includes(w)) continue;
      count.set(w, (count.get(w) ?? 0) + 1);
    }
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w);
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

async function search(body: Record<string, unknown>): Promise<Hit[]> {
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
      return ((await res.json()) as { hits: Hit[] }).hits;
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

  // 1. Titles.
  const words = seedWords(map.roles.map((r) => r.label), PARAMS.MAX_WORDS);
  const seen = new Set<string>();
  const byKey = new Map<string, { postings: number; companies: Set<string>; spellings: Map<string, number> }>();
  for (const [i, word] of words.entries()) {
    const hits = await search({ q: word, attributesToSearchOn: ["title"], limit: 1000, attributesToRetrieve: ["id", "title", "company"] });
    for (const h of hits) {
      if (seen.has(h.id) || !h.title) continue;
      seen.add(h.id);
      const key = titleKey(h.title);
      if (!key) continue;
      const entry = byKey.get(key) ?? { postings: 0, companies: new Set<string>(), spellings: new Map<string, number>() };
      entry.postings++;
      entry.companies.add((h.company ?? "").toLowerCase());
      const plain = h.title.trim();
      if (normalizeTitleName(plain) === key) entry.spellings.set(plain, (entry.spellings.get(plain) ?? 0) + 1);
      byKey.set(key, entry);
    }
    if (i % 100 === 0) console.error(`titles: ${i}/${words.length} words, ${seen.size} postings, ${byKey.size} keys`);
  }
  const kept = [...byKey]
    .filter(([, e]) => e.postings >= PARAMS.MIN_POSTINGS && e.companies.size >= PARAMS.MIN_COMPANIES)
    .sort((a, b) => b[1].postings - a[1].postings || a[0].localeCompare(b[0]))
    .slice(0, PARAMS.MAX_TITLES);

  // 2. Terms.
  const vectors = new Map<string, Map<string, number>>();
  for (const [i, [key]] of kept.entries()) {
    const hits = await search({ q: key, attributesToSearchOn: ["title"], matchingStrategy: "all", limit: 100, attributesToRetrieve: ["id", "title", "company", "description"] });
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
    if (read >= 3) {
      const v = new Map<string, number>();
      for (const [t, c] of termCount) if (c / read >= PARAMS.MIN_TERM_SHARE) v.set(t, c / read);
      if (v.size > 0) vectors.set(key, v);
    }
    if (i % 100 === 0) console.error(`terms: ${i}/${kept.length} titles`);
  }

  // 3. Links.
  const links = postingLinks(vectors, PARAMS.LINKS_PER_TITLE, PARAMS.MIN_COSINE);
  const titleCase = (k: string) => k.replace(/\b\w/g, (c) => c.toUpperCase());
  const out: PostingLinks & { params: typeof PARAMS; requests: number; postingsSeen: number } = {
    generatedAt: new Date().toISOString(),
    params: PARAMS,
    requests,
    postingsSeen: seen.size,
    titles: kept
      .filter(([key]) => vectors.has(key))
      .map(([key, e]) => ({
        key,
        label: [...e.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? titleCase(key),
        postings: e.postings,
        companies: e.companies.size,
      })),
    links,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out) + "\n");
  console.log(JSON.stringify({ out: outPath, requests, postingsSeen: seen.size, keys: byKey.size, kept: kept.length, withTerms: vectors.size, links: links.length }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
