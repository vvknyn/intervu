/**
 * The search's table of roles next to a title (src/lib/jobs/data/title-neighbours.json), read out of the title
 * neighbour map.
 *
 * Keys are the titles a person types: every title Velai's postings use (the map's `postings:` roles) and every
 * classification occupation whose name reads as a job title (`titleLike`: "electrician", "Nurse Practitioners" ->
 * "Nurse Practitioner"; not "Licensed Practical and Licensed Vocational Nurses").
 *
 * For a key T:
 *  1. Its roles are the roles whose display title IS T (`ownRoles`): its postings role, and the O*NET or ESCO
 *     occupation of that name. A role that only lists T among its names is not T (O*NET's Marketing Managers lists
 *     "Product Manager"), so its neighbours are not T's.
 *  2. Each of those roles' links (any kind but `n`, at or above `minWeight`) reaches a role J.
 *  3. J reads as the keys whose own role J is (a posting title first, else its own title-like name). An occupation
 *     with neither adds nothing.
 *  4. A title is dropped when it is T, the same job (it shares a role with T), holds every word of T (the search
 *     already finds it as a title match), is one word ("Manager", "Finance"), or does not end in a word some
 *     classification occupation ends in ("Data Science", "Software Engineering" name a field, not a job; in
 *     "Director of Marketing" the word before "of" counts).
 *  5. Titles linked through Velai's postings come first (they are what the index itself says), then the
 *     classifications' links, each strongest first, paths combined as a noisy-or. A title holding every word of
 *     a kept one is dropped ("Enterprise Account Manager" after "Account Manager": a title search for the
 *     general one finds it). Up to `perTitle` are kept.
 */
import { combineWeights, ownRoles, roleNeighbours, type TitleMap, type TitleMapRole } from "../../src/lib/jobs/title-map";
import { normalizeTitleName } from "../../src/lib/jobs/title-aliases";
import type { TitleNeighbourTable } from "../../src/lib/jobs/title-neighbours";

export const SEARCH_TABLE_DEFAULTS = { perTitle: 6, minWeight: 0.45 };

const words = (s: string) => s.split(" ").filter(Boolean);

/** Whether `title` holds every word of `typed` (a title search for `typed` already finds it). */
export function holdsEveryWord(title: string, typed: string): boolean {
  const have = new Set(words(normalizeTitleName(title)));
  return words(normalizeTitleName(typed)).every((w) => have.has(w));
}

function singular(word: string): string {
  if (/ies$/i.test(word)) return word.replace(/ies$/i, "y");
  if (/(ches|shes|sses|xes)$/i.test(word)) return word.slice(0, -2);
  if (/[^s]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

const SMALL = new Set(["of", "and", "for", "the", "in", "to", "a", "an", "on", "at"]);
const titleCase = (label: string) =>
  label
    .split(" ")
    .map((w, i) => (w === w.toLowerCase() && (i === 0 || !SMALL.has(w)) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

/**
 * The role's name as a job title someone would type, or null when its name is a classification heading: a list
 * ("and", "or", a comma, a slash, brackets) or longer than five words. O*NET names its occupations in the plural.
 */
export function titleLike(role: TitleMapRole): string | null {
  if (role.id.startsWith("postings:")) return role.label;
  const label = role.label.trim();
  if (/[,(/]|\s(and|or|except)\s/i.test(label) || words(label).length > 5) return null;
  if (role.id.startsWith("onet:")) {
    const ws = label.split(" ");
    ws[ws.length - 1] = singular(ws[ws.length - 1]);
    return ws.join(" ");
  }
  return titleCase(label);
}

/** The word a job title ends in, singular; in "director of marketing" the word before "of". */
function headOf(name: string): string {
  const ws = words(normalizeTitleName(name));
  const of = ws.indexOf("of");
  return singular((of > 0 ? ws[of - 1] : ws.at(-1)) ?? "");
}

/** A posting's own spelling, unless it is all capitals or has lowercase words ("Accounting analyst"). */
function displayTitle(title: string): string {
  const base = /[a-z]/.test(title) ? title : title.toLowerCase();
  return base.split(" ").some((w, i) => /^[a-z]/.test(w) && (i === 0 || !SMALL.has(w))) ? titleCase(base) : base;
}

export function searchNeighbourTable(
  map: TitleMap,
  generatedAt: string,
  opts: Partial<typeof SEARCH_TABLE_DEFAULTS> = {},
  /** Normalised posting title -> its open postings (the postings layer's counts). */
  postingCounts: ReadonlyMap<string, number> = new Map(),
): TitleNeighbourTable {
  const { perTitle, minWeight } = { ...SEARCH_TABLE_DEFAULTS, ...opts };

  // Every key with its display title (a posting title's own spelling wins) and its own roles.
  const display = new Map<string, string>();
  for (const role of map.roles) {
    const title = titleLike(role);
    if (!title) continue;
    const key = normalizeTitleName(title);
    if (key && (!display.has(key) || role.id.startsWith("postings:"))) display.set(key, title);
  }
  const postingKeys = new Set(map.roles.filter((r) => r.id.startsWith("postings:")).map((r) => normalizeTitleName(r.label)));
  const rootsOf = new Map<string, Set<string>>();
  const ownBy = new Map<string, string[]>();
  for (const key of display.keys()) {
    // A one-word posting title ("manager", "director") is too broad to have neighbours of its own.
    if (words(key).length < 2 && !map.roles.some((r) => !r.id.startsWith("postings:") && titleLike(r) && normalizeTitleName(titleLike(r)!) === key)) continue;
    const roots = new Set(ownRoles(map, key).map((r) => r.id));
    if (roots.size === 0) continue;
    rootsOf.set(key, roots);
    for (const id of roots) ownBy.set(id, [...(ownBy.get(id) ?? []), key]);
  }
  // Ownership prefers a posting title: when an occupation is the own role of a posting title, it reads as that.
  for (const [id, keys] of ownBy) if (keys.some((k) => postingKeys.has(k))) ownBy.set(id, keys.filter((k) => postingKeys.has(k)));

  // The words a job title ends in, read off the classifications' own occupation titles.
  const heads = new Set(map.roles.filter((r) => !r.id.startsWith("postings:")).map((r) => headOf(r.label)));
  const jobTitle = (key: string) => words(key).length >= 2 && heads.has(headOf(key));
  // Posting titles the search reads as one (a word's plural or singular) read as the commonest of them (rule 6).
  const fold = (key: string) => words(key).map(singular).join(" ");
  const commonest = new Map<string, string>();
  for (const k of postingKeys) {
    const c = commonest.get(fold(k));
    if (!c || (postingCounts.get(k) ?? 0) > (postingCounts.get(c) ?? 0)) commonest.set(fold(k), k);
  }
  const postingId = new Map(map.roles.filter((r) => r.id.startsWith("postings:")).map((r) => [normalizeTitleName(r.label), r.id]));
  const asSearched = new Map<string, string | null>();
  const searchedAs = (target: string): string | null => {
    const c = postingKeys.has(target) ? commonest.get(fold(target)) : undefined;
    if (!c || c === target) return target;
    if (!asSearched.has(target)) {
      const linked = roleNeighbours(map, postingId.get(target)!, Number.MAX_SAFE_INTEGER, 0).some((n) => n.role.id === postingId.get(c));
      asSearched.set(target, linked ? c : null);
    }
    return asSearched.get(target)!;
  };

  const titles: Record<string, string[]> = {};
  for (const [key, roots] of rootsOf) {
    const paths = new Map<string, { weights: number[]; postings: boolean }>();
    for (const root of roots) {
      for (const n of roleNeighbours(map, root, Number.MAX_SAFE_INTEGER, minWeight)) {
        if (roots.has(n.role.id) || n.kinds.every((k) => k === "n")) continue;
        for (const own of ownBy.get(n.role.id) ?? []) {
          const target = searchedAs(own);
          if (!target) continue;
          const sameJob = [...(rootsOf.get(target) ?? [])].some((id) => roots.has(id));
          if (target === key || sameJob || holdsEveryWord(target, key) || !jobTitle(target)) continue;
          const path = paths.get(target) ?? { weights: [], postings: false };
          path.weights.push(n.weight);
          path.postings ||= n.kinds.includes("p");
          paths.set(target, path);
        }
      }
    }
    const ordered = [...paths]
      .map(([target, p]) => ({ target, postings: p.postings, weight: combineWeights(p.weights) }))
      .sort((a, b) => Number(b.postings) - Number(a.postings) || b.weight - a.weight || a.target.localeCompare(b.target));
    // Two or more kinds of one posting title ("Enterprise Account Manager", "Key Account Manager") read as that title.
    const merged = ordered.map(({ target }) => {
      const ws = words(target);
      for (let n = 2; n < ws.length; n++) {
        const general = ws.slice(-n).join(" ");
        if (!postingKeys.has(general) || general === key || holdsEveryWord(general, key) || !jobTitle(general)) continue;
        if (ordered.filter((o) => o.target.endsWith(` ${general}`)).length >= 2) return { target: general };
      }
      return { target };
    });
    const kept: string[] = [];
    for (const { target } of merged) {
      if (kept.length >= perTitle) break;
      if (kept.some((general) => holdsEveryWord(target, general))) continue;
      // A general title found later replaces the kinds of it already kept.
      for (let i = kept.length - 1; i >= 0; i--) if (holdsEveryWord(kept[i], target)) kept.splice(i, 1);
      kept.push(target);
    }
    const ranked = kept.map((target) => displayTitle(display.get(target) ?? target));
    if (ranked.length > 0) titles[key] = ranked;
  }
  return { generatedAt, titles, postingTitles: [...postingKeys].sort() };
}
