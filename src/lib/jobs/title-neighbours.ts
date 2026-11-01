/**
 * Roles next to a typed job title, as titles Velai's postings use ("technical account manager" ->
 * "customer success manager", "solutions engineer", ...): the search's "roles next to this one" band.
 *
 * The table (data/title-neighbours.json) is read out of the title neighbour map (title-map.ts) by
 * scripts/build-title-map.ts (rules in scripts/title-map/search-table.ts); this module is the pure read side.
 */
import { RANK_WORDS } from "../match/duty-signals";
import tableJson from "./data/title-neighbours.json";
import { expandTitleQuery, normalizeTitleName } from "./title-aliases";

export interface TitleNeighbourTable {
  generatedAt: string;
  /** Normalised posting title -> the posting titles next to it, strongest first. */
  titles: Record<string, string[]>;
  /**
   * The normalised titles Velai's postings use (the postings layer's titles): a title only a classification names
   * ("Diet Cook") may have no open posting, so type-ahead suggests only these (`relatedSuggestions`).
   */
  postingTitles?: string[];
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
 * The table key a typed title reads as: the title itself or one of its other names (`expandTitleQuery`), else the
 * same without rank words ("senior accountant" -> "accountant"), else its longest ending that is a key ("licensed
 * electrician" -> "electrician").
 */
function lookupNames(typed: string, table: TitleNeighbourTable): string[] {
  const found = (names: string[]) => names.filter((n) => spellings(n).some((k) => table.titles[k]));
  const direct = found(expandTitleQuery(typed));
  if (direct.length > 0) return direct;
  const unranked = typed.split(" ").filter((w) => !RANK_WORDS.has(w)).join(" ");
  if (unranked && unranked !== typed) {
    const viaUnranked = found(expandTitleQuery(unranked));
    if (viaUnranked.length > 0) return viaUnranked;
  }
  const ws = (unranked || typed).split(" ");
  for (let n = ws.length - 1; n >= 1; n--) {
    const ending = found([ws.slice(-n).join(" ")]);
    if (ending.length > 0) return ending;
  }
  return [];
}

/**
 * Titles of the roles next to the typed one, strongest first, at most `max` (`lookupNames` finds its key). Leaves
 * out the typed title, its other names, and any title holding every typed word (the title search already finds
 * those). An unknown title returns [].
 */
export function relatedTitlesFor(q: string, max = 4, table: TitleNeighbourTable = DEFAULT_TABLE): string[] {
  const typed = normalizeTitleName(q);
  if (!typed) return [];
  const names = lookupNames(typed, table);
  const own = new Set([typed, ...expandTitleQuery(typed), ...names]);
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

/** At most this many related roles are suggested while typing. */
export const SUGGEST_RELATED_CAP = 3;

/**
 * Type-ahead's related roles, read from the same table as the search's related band: those of what is typed, or,
 * while it is not yet a whole title ("technical acc"), those of the first title suggested for it. Only titles
 * Velai's postings use (`postingTitles`), so a pick always finds roles; a title already among `titles` is not
 * repeated.
 */
export function relatedSuggestions(q: string, titles: readonly string[], max = SUGGEST_RELATED_CAP, table: TitleNeighbourTable = DEFAULT_TABLE): string[] {
  const shown = new Set(titles.map((t) => normalizeTitleName(t)));
  const posted = table.postingTitles ? new Set(table.postingTitles) : null;
  const usable = (list: string[]) => list.filter((t) => !shown.has(normalizeTitleName(t)) && (!posted || posted.has(normalizeTitleName(t))));
  const typed = usable(relatedTitlesFor(q, Number.MAX_SAFE_INTEGER, table));
  const from = typed.length > 0 ? typed : titles[0] ? usable(relatedTitlesFor(titles[0], Number.MAX_SAFE_INTEGER, table)) : [];
  return from.slice(0, max);
}
