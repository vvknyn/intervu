/**
 * Scores the alias graph against TechWolf's JobBERT evaluation set (MIT; vacancy title -> ESCO v1.0.5 URI).
 * Evaluation only: the data is never written to the artifact.
 *
 *   npx tsx scripts/eval-title-aliases-techwolf.ts [--graph alt.json] <jobbert_ds_test.csv> [more.csv ...]
 *
 * --graph scores another generated graph (for example one layer of sources) instead of the committed artifact.
 *
 * Only titles present in BOTH the file and the graph are scored, as unordered pairs.
 *   precision = of the pairs the graph expands (either direction), the share TechWolf puts under one ESCO URI.
 *   recall    = of the pairs TechWolf puts under one ESCO URI, the share the graph expands.
 * The gold labels are ESCO occupations and the graph lists plain synonyms and is silent on finer ESCO splits, so read recall as a lower bound and precision as strict.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import graphJson from "../src/lib/jobs/data/title-aliases.json";
import { expandTitleQuery, normalizeTitleName, type TitleAliasGraph } from "../src/lib/jobs/title-aliases";
import { parseCsvRecords } from "./title-alias-sources/csv";

export function scorePairs(titleUris: Map<string, Set<string>>, expand: (title: string) => string[]) {
  const titles = [...titleUris.keys()];
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const expanded = new Set<string>();
  for (const a of titles) for (const b of expand(a)) if (b !== a && titleUris.has(b)) expanded.add(pairKey(a, b));
  const sameUri = (a: string, b: string) => [...titleUris.get(a)!].some((u) => titleUris.get(b)!.has(u));
  let expandedSame = 0;
  for (const k of expanded) {
    const [a, b] = k.split("\u0000");
    if (sameUri(a, b)) expandedSame++;
  }
  const byUri = new Map<string, string[]>();
  for (const [t, uris] of titleUris) for (const u of uris) byUri.set(u, [...(byUri.get(u) ?? []), t]);
  const gold = new Set<string>();
  for (const members of byUri.values()) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) gold.add(pairKey(members[i], members[j]));
  let goldExpanded = 0;
  for (const k of gold) if (expanded.has(k)) goldExpanded++;
  return {
    titles: titles.length,
    expandedPairs: expanded.size,
    expandedSameUri: expandedSame,
    goldPairs: gold.size,
    goldExpanded,
    precision: expanded.size ? expandedSame / expanded.size : NaN,
    recall: gold.size ? goldExpanded / gold.size : NaN,
  };
}

function main(args: string[]) {
  const at = args.indexOf("--graph");
  const graph = at < 0 ? (graphJson as TitleAliasGraph) : (JSON.parse(readFileSync(args[at + 1], "utf8")) as TitleAliasGraph);
  const files = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
  if (files.length === 0) throw new Error("usage: eval-title-aliases-techwolf.ts [--graph alt.json] <csv> [csv...]");
  const known = new Set(graph.concepts.flatMap((c) => c.names));
  const titleUris = new Map<string, Set<string>>();
  for (const file of files) {
    for (const row of parseCsvRecords(readFileSync(file, "utf8"))) {
      const title = normalizeTitleName(row.vacancy_job_title);
      if (!known.has(title)) continue;
      titleUris.set(title, (titleUris.get(title) ?? new Set()).add(row.esco_URI));
    }
  }
  console.log(JSON.stringify(scorePairs(titleUris, (t) => expandTitleQuery(t, graph)), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
