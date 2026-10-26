/**
 * Generates src/lib/jobs/data/title-aliases.json from the public taxonomies in
 * scripts/title-alias-sources. Raw downloads are untrusted data: they are only
 * read as text, never executed.
 *
 *   npx tsx scripts/build-title-aliases.ts <work-dir> [out.json]
 *
 * Files missing from <work-dir> are fetched from the loader's official URL.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitleNames, type TitleAliasGraph, type TitleConcept } from "../src/lib/jobs/title-aliases";
import { TITLE_SOURCE_LOADERS } from "./title-alias-sources";
import { readXlsxRows } from "./title-alias-sources/xlsx";
import type { TitleSourceLoader } from "./title-alias-sources/types";

/**
 * Concepts of DIFFERENT sources are one occupation when they share an official
 * code (O*NET-SOC / ESCO URI: the ESCO<->O*NET crosswalk, v1 rows only). Same-source
 * and "group"-level concepts never merge: sharing an ISCO unit group is not synonymy,
 * and a shared name is not a join (it would chain through generic titles).
 */
export function mergeAcrossSources(concepts: TitleConcept[]): TitleConcept[] {
  const parent = concepts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owners = new Map<string, number>();
  const join = (key: string, i: number) => {
    const j = owners.get(key);
    if (j === undefined) owners.set(key, i);
    else if (concepts[j].source !== concepts[i].source) parent[find(i)] = find(j);
  };
  concepts.forEach((c, i) => {
    if (c.matchLevel !== "concept") return;
    if (c.onetSoc) join(`onet\u0000${c.onetSoc}`, i);
    if (c.escoUri) join(`esco\u0000${c.escoUri}`, i);
  });
  const merged = new Map<number, TitleConcept>();
  concepts.forEach((c, i) => {
    const root = find(i);
    const into = merged.get(root);
    if (!into) merged.set(root, { ...c, names: [...c.names] });
    else {
      into.joinedBy = "crosswalk";
      into.source = [...new Set([...into.source.split("+"), c.source])].sort().join("+");
      into.names = [...new Set([...into.names, ...c.names])];
      into.escoUri ??= c.escoUri;
      into.onetSoc ??= c.onetSoc;
      into.isco08 ??= c.isco08;
      into.soc2018 ??= c.soc2018;
    }
  });
  return [...merged.values()];
}

/**
 * A concept-level source coded only with a detailed SOC 2018 joins O*NET when that
 * code maps to exactly one O*NET-SOC code, else it is dropped (never a guess). A concept
 * carrying no external code at all (a Wikidata item) is its own identity and stays.
 * Every group-level concept is dropped.
 */
export function resolveSocCodes(concepts: TitleConcept[]): TitleConcept[] {
  const byOnet = new Map<string, Set<string>>();
  for (const c of concepts) if (c.onetSoc && c.soc2018) byOnet.set(c.soc2018, (byOnet.get(c.soc2018) ?? new Set()).add(c.onetSoc));
  return concepts.flatMap((c) => {
    if (c.matchLevel !== "concept") return [];
    if (c.onetSoc || c.escoUri || !c.soc2018) return [c];
    const hit = c.soc2018 ? byOnet.get(c.soc2018) : undefined;
    return hit?.size === 1 ? [{ ...c, onetSoc: [...hit][0] }] : [];
  });
}

/** A name held by more than one detailed occupation (SOC 2018 code; O*NET specialties share theirs) names none of them: drop it everywhere. */
export function dropAmbiguousNames(concepts: TitleConcept[]): TitleConcept[] {
  const holders = new Map<string, Set<string>>();
  for (const c of concepts) for (const n of c.names) holders.set(n, (holders.get(n) ?? new Set()).add(c.soc2018 ?? c.id));
  return concepts.map((c) => ({ ...c, names: c.names.filter((n) => holders.get(n)!.size === 1) })).filter((c) => c.names.length > 0);
}

export function buildGraph(
  loaded: Array<{ loader: TitleSourceLoader; sha256: Record<string, string>; contents: Record<string, string> }>,
): TitleAliasGraph {
  const concepts: TitleConcept[] = [];
  for (const { loader, contents } of loaded) {
    for (const raw of loader.parse(contents)) {
      const names = [...new Set(raw.names.flatMap(normalizeTitleNames))];
      if (names.length > 0) concepts.push({ ...raw, source: loader.id, names });
    }
  }
  return {
    sources: loaded.map(({ loader, sha256 }) => ({
      id: loader.id,
      label: loader.label,
      version: loader.version,
      license: loader.license,
      files: loader.files.map(({ name, url }) => ({ name, url, sha256: sha256[name] })),
    })),
    concepts: dropAmbiguousNames(mergeAcrossSources(resolveSocCodes(concepts))).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

async function main() {
  const [workDir, outArg] = process.argv.slice(2);
  if (!workDir) throw new Error("usage: build-title-aliases.ts <work-dir> [out.json]");
  mkdirSync(workDir, { recursive: true });
  const loaded = [];
  for (const loader of TITLE_SOURCE_LOADERS) {
    const contents: Record<string, string> = {};
    const sha256: Record<string, string> = {};
    for (const file of loader.files) {
      const path = join(workDir, `${loader.id}-${file.name}`);
      if (!existsSync(path)) {
        if (file.fetchBody) writeFileSync(path, await file.fetchBody());
        else {
          const res = await fetch(file.url);
          if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
          writeFileSync(path, Buffer.from(await res.arrayBuffer()));
        }
      }
      const bytes = readFileSync(path);
      contents[file.name] = file.name.endsWith(".xlsx") ? JSON.stringify(readXlsxRows(bytes)) : bytes.toString("utf8");
      sha256[file.name] = createHash("sha256").update(bytes).digest("hex");
    }
    loaded.push({ loader, sha256, contents });
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(outArg ?? join(here, "../src/lib/jobs/data/title-aliases.json"));
  writeFileSync(out, JSON.stringify(buildGraph(loaded)) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
