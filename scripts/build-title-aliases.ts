/**
 * Generates src/lib/jobs/data/title-aliases.json from the occupation sources in
 * scripts/title-alias-sources. Raw downloads are untrusted data: they are only
 * read as text, never executed.
 *
 *   npx tsx scripts/build-title-aliases.ts <work-dir> [out.json]
 *
 * Files missing from <work-dir> are fetched by the loader (a plain GET, or its paged query).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTitleNames, type TitleAliasGraph, type TitleConcept } from "../src/lib/jobs/title-aliases";
import { TITLE_SOURCE_LOADERS } from "./title-alias-sources";
import type { TitleSourceLoader } from "./title-alias-sources/types";

/** A name held by more than one concept names none of them: drop it everywhere (no chaining through generic titles). */
export function dropAmbiguousNames(concepts: TitleConcept[]): TitleConcept[] {
  const holders = new Map<string, Set<string>>();
  for (const c of concepts) for (const n of c.names) holders.set(n, (holders.get(n) ?? new Set()).add(c.id));
  return concepts.map((c) => ({ ...c, names: c.names.filter((n) => holders.get(n)!.size === 1) })).filter((c) => c.names.length > 0);
}

export function buildGraph(
  loaded: Array<{ loader: TitleSourceLoader; sha256: Record<string, string>; contents: Record<string, string> }>,
): TitleAliasGraph {
  const concepts: TitleConcept[] = [];
  for (const { loader, contents } of loaded) {
    for (const raw of loader.parse(contents)) {
      const names = [...new Set(raw.names.flatMap(normalizeTitleNames))];
      if (names.length > 0) concepts.push({ id: raw.id, source: loader.id, names });
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
    concepts: dropAmbiguousNames(concepts).sort((a, b) => a.id.localeCompare(b.id)),
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
      contents[file.name] = bytes.toString("utf8");
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
