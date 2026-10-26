/**
 * Occupation alias graph: a typed job title also finds the occupation's other
 * names ("speech-language pathologist" <-> "speech and language therapist").
 *
 * The graph (data/title-aliases.json) is generated from a public occupation list by
 * scripts/build-title-aliases.ts; this module is the pure read side. The
 * generator imports `normalizeTitleNames` from here, so a name is normalised
 * the same way when it is written and when it is looked up.
 */
import graphJson from "./data/title-aliases.json";
import { placeNamed } from "./resume-location";

/** One occupation, as a synonym-level item of a source (a Wikidata occupation). */
export interface TitleConcept {
  id: string;
  source: string;
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

/** A source may list the plural ("Registered Nurses"); a typed title is usually singular. */
function withPlurals(name: string): string[] {
  return [name, name.endsWith("y") ? `${name.slice(0, -1)}ies` : `${name}s`, `${name}es`];
}

/**
 * The typed query first, then the other names of its occupation. Expands only
 * when the whole normalised query IS a known name (or its plural form) of exactly one
 * occupation. An unknown title returns just itself; an empty query returns [].
 */
export function expandTitleQuery(q: string, graph: TitleAliasGraph = DEFAULT_GRAPH): string[] {
  const typed = normalizeTitleName(q);
  if (!typed) return [];
  const index = nameIndex(graph);
  const concepts = [...new Set(withPlurals(typed).flatMap((name) => index.get(name) ?? []))];
  if (concepts.length !== 1) return [typed];
  return [...new Set([typed, ...concepts[0].names.filter((alias) => isSynonymAlias(typed, alias))])];
}

/**
 * Whether `alias` may be EMITTED as a query for typed `typed` (any name stays a lookup KEY, so "slp" still expands).
 * Dropped: a single token of 3 chars or fewer ("pt" reads as part-time), a place ("portugal"), and a sibling
 * specialty, which keeps the head noun and swaps the modifier ("technical program manager" for "product manager")
 * unless it carries every typed word. Symmetric, so the sibling does not expand back either.
 * Accepted cost: true synonyms that share a head noun (truck driver / lorry driver) drop.
 */
function isSynonymAlias(typed: string, alias: string): boolean {
  if (alias === typed) return true;
  const words = alias.split(" ");
  if (words.length === 1 && alias.length <= 3) return false;
  if (placeNamed(alias)) return false;
  const typedWords = typed.split(" ");
  const sameHead = withPlurals(typedWords.at(-1)!).includes(words.at(-1)!) || withPlurals(words.at(-1)!).includes(typedWords.at(-1)!);
  return !sameHead || typedWords.every((w) => words.some((a) => withPlurals(w).includes(a) || withPlurals(a).includes(w)));
}

const DEFAULT_GRAPH = graphJson as TitleAliasGraph;
