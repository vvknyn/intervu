import type { RawConcept, TitleSourceLoader } from "./types";

const ENDPOINT = "https://query.wikidata.org/sparql";
const FILE = "wikidata-occupations.json";
const USER_AGENT = "VelaiTitleAliasBuilder/1.0 (https://velai.io; vivek.nar87@gmail.com) paged occupation label download";
const BATCH = 400;

/** Occupation items: instance or subclass of occupation (Q12737077) or profession (Q28640). */
export const WIKIDATA_ITEMS_QUERY = `SELECT DISTINCT ?item WHERE { VALUES ?root { wd:Q28640 wd:Q12737077 } ?item wdt:P31|wdt:P279 ?root . }`;
export const wikidataLabelsQuery = (qids: string[]) => `SELECT ?item ?label (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  ?item rdfs:label ?label . FILTER(LANG(?label) = "en")
  OPTIONAL { ?item skos:altLabel ?alias . FILTER(LANG(?alias) = "en") }
} GROUP BY ?item ?label`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sparql(query: string): Promise<Array<Record<string, { value: string }>>> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) return (await res.json()).results.bindings;
    await sleep(10_000 * attempt);
  }
  throw new Error("query.wikidata.org: gave up after 4 attempts");
}

/** Item ids first (one light query), then labels + aliases in polite batches: a single paged join times out (504). */
async function fetchOccupationRows(): Promise<string> {
  const qids = (await sparql(WIKIDATA_ITEMS_QUERY)).map((b) => b.item.value.split("/").pop()!);
  const rows: Array<{ item: string; label: string; aliases: string }> = [];
  for (let i = 0; i < qids.length; i += BATCH) {
    for (const b of await sparql(wikidataLabelsQuery(qids.slice(i, i + BATCH)))) rows.push({ item: b.item.value.split("/").pop()!, label: b.label.value, aliases: b.aliases.value });
    await sleep(2_000);
  }
  return JSON.stringify(rows);
}

/**
 * Wikidata occupation items (CC0). One concept per item: its English label, then its
 * "also known as" aliases. The item is the synonym-level unit, so it needs no external code.
 */
export const wikidataLoader: TitleSourceLoader = {
  id: "wikidata",
  label: "Wikidata occupations (query.wikidata.org)",
  version: "SPARQL snapshot 2026-10-26",
  license: "CC0 1.0",
  files: [{ name: FILE, url: ENDPOINT, fetchBody: fetchOccupationRows }],
  parse(files) {
    const rows = JSON.parse(files[FILE]) as Array<{ item: string; label: string; aliases: string }>;
    return rows
      .filter((r) => /^Q\d+$/.test(r.item)) // the query also returns a few properties (P…)
      .map((r): RawConcept => ({ id: `wikidata:${r.item}`, names: [r.label, ...(r.aliases ? r.aliases.split("|") : [])] }));
  },
};
