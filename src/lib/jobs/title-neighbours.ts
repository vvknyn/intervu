/**
 * Roles next to a typed job title, as titles Velai's postings use ("technical account manager" ->
 * "customer success manager", "solutions engineer", ...): the search's "roles next to this one" band.
 *
 * The table (data/title-neighbours.json) is read out of the title neighbour map (title-map.ts) by
 * scripts/build-title-map.ts (rules in scripts/title-map/search-table.ts); this module is the pure read side.
 */
import tableJson from "./data/title-neighbours.json";
import { expandTitleQuery, normalizeTitleName } from "./title-aliases";

export interface TitleNeighbourTable {
  generatedAt: string;
  /** Normalised posting title -> the posting titles next to it, strongest first. */
  titles: Record<string, string[]>;
}

const DEFAULT_TABLE = tableJson as TitleNeighbourTable;

/** A typed title is often the plural or singular of the posting title ("registered nurses"). */
function spellings(name: string): string[] {
  const out = [name];
  if (name.endsWith("ies")) out.push(`${name.slice(0, -3)}y`);
  else if (name.endsWith("es")) out.push(name.slice(0, -2), name.slice(0, -1));
  else if (name.endsWith("s")) out.push(name.slice(0, -1));
  return out;
}

const holdsEveryWord = (title: string, typedWords: string[]) => {
  const have = new Set(title.split(" "));
  return typedWords.every((w) => spellings(w).some((s) => have.has(s)));
};

/**
 * Titles of the roles next to the typed one, strongest first, at most `max`. Looked up by the typed title and its
 * other names (`expandTitleQuery`). Leaves out the typed title, its other names, and any title holding every typed
 * word (the title search already finds those). An unknown title returns [].
 */
export function relatedTitlesFor(q: string, max = 4, table: TitleNeighbourTable = DEFAULT_TABLE): string[] {
  const typed = normalizeTitleName(q);
  if (!typed) return [];
  const names = expandTitleQuery(typed);
  const own = new Set(names);
  const typedWords = typed.split(" ");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    for (const key of spellings(name)) {
      for (const title of table.titles[key] ?? []) {
        const k = normalizeTitleName(title);
        if (own.has(k) || seen.has(k) || holdsEveryWord(k, typedWords)) continue;
        seen.add(k);
        out.push(title);
      }
    }
  }
  return out.slice(0, max);
}
