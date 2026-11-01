/**
 * The search's table of roles next to a title (src/lib/jobs/data/title-neighbours.json), read out of the title
 * neighbour map. Keys and values are titles Velai's own postings use (the map's `postings:` roles), so every
 * neighbour a search adds is a title with postings behind it.
 *
 * For a posting title T:
 *  1. Its roles are the roles whose display title IS T (`ownRoles`): its postings role, and the O*NET or ESCO
 *     occupation of that name when one exists. A role that only lists T among its names is not T
 *     (O*NET's Marketing Managers lists "Product Manager"), so its neighbours are not T's.
 *  2. Each of those roles' links (any kind but `n`, at or above `minWeight`) reaches a role J.
 *  3. J reads as the posting titles whose own role J is, by the same rule; J itself when J is a postings role.
 *     A classification occupation no posting title is named after adds nothing.
 *  4. A title is dropped when it is T, the same job (it shares a role with T), or holds every word of T (the
 *     search already finds it as a title match). The rest are kept strongest first, combining paths as a
 *     noisy-or, up to `perTitle`.
 */
import { combineWeights, ownRoles, roleNeighbours, type TitleMap } from "../../src/lib/jobs/title-map";
import { normalizeTitleName } from "../../src/lib/jobs/title-aliases";
import type { TitleNeighbourTable } from "../../src/lib/jobs/title-neighbours";

export const SEARCH_TABLE_DEFAULTS = { perTitle: 6, minWeight: 0.3 };

const words = (s: string) => s.split(" ").filter(Boolean);

/** Whether `title` holds every word of `typed` (a title search for `typed` already finds it). */
export function holdsEveryWord(title: string, typed: string): boolean {
  const have = new Set(words(normalizeTitleName(title)));
  return words(normalizeTitleName(typed)).every((w) => have.has(w));
}

export function searchNeighbourTable(
  map: TitleMap,
  generatedAt: string,
  opts: Partial<typeof SEARCH_TABLE_DEFAULTS> = {},
): TitleNeighbourTable {
  const { perTitle, minWeight } = { ...SEARCH_TABLE_DEFAULTS, ...opts };
  const postings = map.roles.filter((r) => r.id.startsWith("postings:"));

  // Role id -> the posting titles it is the own role of.
  const ownBy = new Map<string, string[]>();
  const rootsOf = new Map<string, string[]>();
  for (const p of postings) {
    const roots = ownRoles(map, p.label).map((r) => r.id);
    if (!roots.includes(p.id)) roots.push(p.id);
    rootsOf.set(p.id, roots);
    for (const id of roots) ownBy.set(id, [...(ownBy.get(id) ?? []), p.label]);
  }

  const titles: Record<string, string[]> = {};
  for (const p of postings) {
    const key = normalizeTitleName(p.label);
    const roots = new Set(rootsOf.get(p.id));
    const paths = new Map<string, number[]>();
    for (const root of roots) {
      for (const n of roleNeighbours(map, root, Number.MAX_SAFE_INTEGER, minWeight)) {
        if (roots.has(n.role.id) || n.kinds.every((k) => k === "n")) continue;
        for (const title of ownBy.get(n.role.id) ?? []) {
          const sameJob = (rootsOf.get(`postings:${normalizeTitleName(title)}`) ?? []).some((id) => roots.has(id));
          if (normalizeTitleName(title) === key || sameJob || holdsEveryWord(title, p.label)) continue;
          paths.set(title, [...(paths.get(title) ?? []), n.weight]);
        }
      }
    }
    const ranked = [...paths]
      .map(([title, ws]) => [title, combineWeights(ws)] as const)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, perTitle)
      .map(([title]) => title);
    if (ranked.length > 0) titles[key] = ranked;
  }
  return { generatedAt, titles };
}
