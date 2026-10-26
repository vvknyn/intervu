/**
 * Occupation alias graph: a typed job title also finds the occupation's other
 * names ("speech-language pathologist" <-> "speech and language therapist").
 *
 * The graph (data/title-aliases.json) is generated from public taxonomies by
 * scripts/build-title-aliases.ts; this module is the pure read side. The
 * generator imports `normalizeTitleNames` from here, so a name is normalised
 * the same way when it is written and when it is looked up.
 */
import graphJson from "./data/title-aliases.json";

/** One occupation. `group` is the loader's major-group key: names shared by concepts of different groups are ambiguous. */
export interface TitleConcept {
  id: string;
  source: string;
  lang: string;
  group: string;
  /** Only "concept" rows expand; a "group" row (coarse unit group) is never a synonym of its neighbours. */
  matchLevel: "concept" | "group";
  /** Hub and join keys, when the source carries them (ISCO-08, SOC 2018, ESCO URI, O*NET-SOC). */
  isco08?: string;
  soc2018?: string;
  escoUri?: string;
  onetSoc?: string;
  /** How a merged concept was joined: "crosswalk" (shared official code) or "name" (name-overlap fallback). */
  joinedBy?: "crosswalk" | "name";
  /** Normalised, preferred name first. */
  names: string[];
}

export interface TitleSourceMeta {
  id: string;
  label: string;
  version: string;
  license: string;
  files: Array<{ name: string; url: string; sha256: string }>;
}

export interface TitleAliasGraph {
  sources: TitleSourceMeta[];
  concepts: TitleConcept[];
}

/** Lowercase, fold diacritics, `&` -> and, every other non-alphanumeric run -> one space. */
export function normalizeTitleName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim();
}

/** "CEO (Chief Executive Officer)" -> both spellings, each normalised. Empty and one-character names are dropped. */
export function normalizeTitleNames(raw: string): string[] {
  const parts = raw.match(/^(.*?)\(([^()]*)\)(.*)$/);
  const spellings = parts ? [`${parts[1]} ${parts[3]}`, parts[2]] : [raw];
  return [...new Set(spellings.map(normalizeTitleName).filter((n) => n.length > 1))];
}

const indexes = new WeakMap<TitleAliasGraph, Map<string, TitleConcept[]>>();

function nameIndex(graph: TitleAliasGraph): Map<string, TitleConcept[]> {
  let index = indexes.get(graph);
  if (!index) {
    index = new Map();
    for (const concept of graph.concepts) {
      for (const name of concept.names) {
        const list = index.get(name);
        if (list) list.push(concept);
        else index.set(name, [concept]);
      }
    }
    indexes.set(graph, index);
  }
  return index;
}

/** O*NET titles are plural classification labels ("Registered Nurses"); a typed title is singular. */
function withPlurals(name: string): string[] {
  return [name, name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`, `${name}es`];
}

/**
 * The typed query first, then the other names of its occupation. Expands only
 * when the whole normalised query IS a known name, and never when that name
 * belongs to occupations in different major groups ("therapist", "manager").
 * An unknown title returns just itself; an empty query returns [].
 */
export function expandTitleQuery(q: string, graph: TitleAliasGraph = DEFAULT_GRAPH): string[] {
  const typed = normalizeTitleName(q);
  if (!typed) return [];
  const index = nameIndex(graph);
  const concepts = [...new Set(withPlurals(typed).flatMap((name) => index.get(name) ?? []))].filter((c) => c.matchLevel === "concept");
  if (new Set(concepts.map((c) => c.group)).size > 1) return [typed];
  return [...new Set([typed, ...concepts.flatMap((c) => c.names)])];
}

const DEFAULT_GRAPH = graphJson as TitleAliasGraph;
