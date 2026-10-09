/**
 * Seniority+role title-lane helpers.
 *
 * Lives here (not query-understanding.ts) so meilisearch can import them
 * without pulling resolve-place → JOBS_SYNONYMS, which is a load-time cycle.
 */
import { meaningfulTitleTokens } from "./presentation";
import { isTechSkillQuery } from "./tech-skills";

/** [match, experience_level, title-lane prefix]. Null prefix = bucket signal only. */
export const SENIORITY_PHRASES: ReadonlyArray<readonly [RegExp, string, string | null]> = [
  [/\bintern(?:ship)?\b/gi, "intern", "intern"],
  [/\bsummer intern(?:ship)?\b/gi, "intern", null],
  [/\bco-?op\b/gi, "intern", "intern"],
  [/\bjunior\b/gi, "entry", "junior"],
  [/\bentry[- ]level\b/gi, "entry", null],
  [/\bnew grad(?:uate)?\b/gi, "entry", null],
  [/\bassociate\b/gi, "entry", "associate"],
  [/\bdirector\b/gi, "executive", "director"],
  [/\bvice president\b/gi, "executive", "vice president"],
  [/\bvp\b/gi, "executive", "vp"],
  [/\bhead of\b/gi, "executive", "head of"],
  [/\bchief\b/gi, "executive", "chief"],
  [/\bc-level\b/gi, "executive", null],
];

function findSeniorityAnchors(q: string): string[] {
  const anchors: string[] = [];
  for (const [re] of SENIORITY_PHRASES) {
    for (const m of q.matchAll(new RegExp(re.source, re.flags))) {
      anchors.push(m[0].toLowerCase().replace(/\s+/g, " ").trim());
    }
  }
  return [...new Set(anchors)];
}

/** Prefixes in the same seniority bucket as whatever the query named. */
function expandedPairPrefixes(q: string): string[] {
  const buckets = new Set<string>();
  for (const [re, canonical] of SENIORITY_PHRASES) {
    if ([...q.matchAll(new RegExp(re.source, re.flags))].length > 0) buckets.add(canonical);
  }
  const prefixes: string[] = [];
  const seen = new Set<string>();
  for (const [, canonical, prefix] of SENIORITY_PHRASES) {
    if (!prefix || !buckets.has(canonical) || seen.has(prefix)) continue;
    seen.add(prefix);
    prefixes.push(prefix);
  }
  return prefixes;
}

function sortedTokenKey(tokens: readonly string[]): string {
  return [...tokens].sort().join("|");
}

const ROLE_TITLE_PAIR_CAP = 12;

/** Title-only pair queries for seniority+role recall (e.g. "director brand").
 *  Executive tokens expand to director/vp/head of/chief so a director query
 *  also retrieves VP Product / Head of Brand titles. A pair that is just the
 *  typed query ("associate warehouse" for "Warehouse Associate") never runs
 *  the lane on its own, but leads it when other pairs do: the lane is the
 *  whole result, so without it "Warehouse Associate" found only "Junior
 *  Warehouse" titles. */
export function roleTitlePairQueries(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return [];

  const prefixes = expandedPairPrefixes(trimmed);
  if (prefixes.length === 0) return [];

  const typedAnchors = findSeniorityAnchors(trimmed);
  const typedAnchorTokens = new Set<string>();
  for (const anchor of typedAnchors) {
    for (const t of meaningfulTitleTokens(anchor)) typedAnchorTokens.add(t);
  }
  const remaining = meaningfulTitleTokens(trimmed).filter((t) => !typedAnchorTokens.has(t));
  if (remaining.length === 0) return [];

  const fullKey = sortedTokenKey(meaningfulTitleTokens(trimmed));
  const pairs: string[] = [];
  let typedPair: string | null = null;
  outer: for (const prefix of prefixes) {
    for (const token of remaining) {
      const pair = `${prefix} ${token}`;
      if (sortedTokenKey(meaningfulTitleTokens(pair)) === fullKey) {
        typedPair ??= pair;
        continue;
      }
      pairs.push(pair);
      if (pairs.length >= ROLE_TITLE_PAIR_CAP - 1) break outer;
    }
  }
  if (pairs.length === 0) return [];
  return typedPair ? [typedPair, ...pairs] : pairs;
}

/** True when `title` carries a seniority token in the query's bucket AND at
 *  least one other meaningful query token. One-token titles (Brand Designer,
 *  Account Director, Art Director) fail. Queries with no seniority+role pairs
 *  are not this class — always true, so stripe/rust are untouched.
 *  Remaining tokens match exactly or +s (product ≠ production). */
export function titleSatisfiesRoleQuery(title: string, q: string): boolean {
  if (roleTitlePairQueries(q).length === 0) return true;

  const prefixes = expandedPairPrefixes(q.trim());
  const titleTokens = meaningfulTitleTokens(title);
  const typedAnchorTokens = new Set<string>();
  for (const anchor of findSeniorityAnchors(q.trim())) {
    for (const t of meaningfulTitleTokens(anchor)) typedAnchorTokens.add(t);
  }
  const remaining = meaningfulTitleTokens(q.trim()).filter((t) => !typedAnchorTokens.has(t));

  const tokenInTitle = (want: string) =>
    titleTokens.some((tt) => tt === want || tt.startsWith(want));
  const hasAnchor = prefixes.some((prefix) =>
    meaningfulTitleTokens(prefix).every(tokenInTitle),
  );
  const hasOther = remaining.some((rt) =>
    titleTokens.some((tt) => tt === rt || tt === `${rt}s` || rt === `${tt}s`),
  );
  return hasAnchor && hasOther;
}

export function shouldRunRoleTitleLane(
  q: string,
  companyScoped: boolean,
): boolean {
  if (companyScoped) return false;
  if (isTechSkillQuery(q)) return false;
  return roleTitlePairQueries(q).length > 0;
}
