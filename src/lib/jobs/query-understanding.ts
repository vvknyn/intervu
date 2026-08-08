/**
 * Deterministic query understanding for jobs search (S1, spec §6.2).
 *
 * Work-arrangement tokens typed in the query become the SAME strict
 * `work_type` facet filter the FilterPanel applies when clicked — "typing it
 * = clicking it". A fixed phrase table, no NLP, so it can never misfire on
 * novel input.
 *
 * Seniority tokens are deliberately NOT parsed into `experience_level`
 * filters: measured live 2026-07-21, the corpus is 76% "mid" (classifier
 * dump bucket), so a seniority filter would DROP correctly-titled senior
 * roles that title-first ranking (see searchMeili's precision pass) already
 * orders correctly.
 */
import type { JobSearchParams, PlaceClause } from "./types";
import type { Gazetteer } from "../geo/gazetteer";
import type { CorpusValueChecker } from "../geo/corpus-values";
import { scanPlacePhrases } from "../geo/resolve-place";

export interface ParsedQuery {
  /** Query text with recognized tokens removed (may be empty). */
  residualQ: string;
  /** Canonical `work_type` facet values implied by the query (corpus vocabulary: remote | hybrid | onsite). */
  workTypes: string[];
}

/** Longest phrases first, so "work from home" is consumed before any single-word pass could see its words. */
const WORK_TYPE_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwork[- ]from[- ]home\b/gi, "remote"],
  [/\bin[- ]office\b/gi, "onsite"],
  [/\bon[- ]site\b/gi, "onsite"],
  [/\bwfh\b/gi, "remote"],
  [/\bremote\b/gi, "remote"],
  [/\bhybrid\b/gi, "hybrid"],
  [/\bonsite\b/gi, "onsite"],
];

/** Pure — no I/O, so behavior locks under unit test. */
export function parseWorkTypeTokens(q: string): ParsedQuery {
  let residual = q;
  const found = new Set<string>();
  for (const [re, canonical] of WORK_TYPE_PHRASES) {
    const next = residual.replace(re, " ");
    if (next !== residual) {
      found.add(canonical);
      residual = next;
    }
  }
  return { residualQ: residual.replace(/\s+/g, " ").trim(), workTypes: [...found] };
}

/* ----------------------- place tokens → filters ----------------------- */

/**
 * Place words typed in a query become location FILTERS, not content words.
 *
 * Why this exists (observed live, 2026-07-26): "Technical Account Manager
 * canada" ranked *Territory* Account Manager roles in Charlotte and Fort
 * Worth first — US postings whose descriptions merely mention Canada. Full-
 * document matching finds every job containing "canada"; only a filter can
 * express that the searcher meant "IN Canada". Same principle as the
 * work-type table above: typing it = clicking it.
 *
 * Matching is gazetteer-backed (lib/geo/resolve-place.ts): recognizing a
 * typed phrase as a real place no longer depends on the corpus's capped,
 * count-thresholded facet vocabulary, so it also reaches places that never
 * cleared that cap ("Markham", "MISSISSAUGA") via the matched city's
 * radius-neighbor expansion. Every candidate the gazetteer proposes is still
 * checked against the live corpus (lib/geo/corpus-values.ts) before becoming
 * a filter — an alias can never invent a filter the corpus can't satisfy.
 */
export interface LocationVocabulary {
  gazetteer: Gazetteer;
  corpusChecker: CorpusValueChecker;
}

export interface ParsedPlaces {
  /** Query text with the matched place phrases removed (may be empty). */
  residualQ: string;
  /** One clause per matched place — OR'd by `buildFilter`. */
  places: PlaceClause[];
}

/**
 * Gazetteer-scan the query for place phrases (pure), then validate every
 * candidate the match(es) produced against the live corpus (I/O, cached —
 * see corpus-values.ts). This is the ONE place resolver: both free-text
 * queries (via `applyQueryUnderstanding` below, from `searchJobs` in
 * search.ts) and the MCP `search_jobs` tool's explicit `location` param
 * (`resolvePlaces` in agent/tools.ts) call this exact function against the
 * same cached `LocationVocabulary` (`locationVocabulary()` in search.ts).
 *
 * Each resolution validates as TWO groups in one batched checker call — its
 * own candidates, and (for a city/metro match only) its resolved country's
 * candidates — so the result can carry `scopedToCountry` separately from
 * `any` (see `PlaceClause`, jobs/types.ts) without a second network round
 * trip: the underlying facet-search hits are still fetched once per unique
 * (field, value) regardless of which group needed them.
 *
 * A recognized place phrase leaves the RESIDUAL query even when nothing it
 * expanded to survives corpus validation (a real place, but this corpus has
 * zero postings tagged with it) — it is never put back as a content word.
 * That's deliberate, not a gap: full-text matching on a bare place name is
 * exactly the failure this whole mechanism exists to avoid (see the module
 * doc above — "Technical Account Manager canada" ranking on descriptions
 * that merely MENTION Canada). A word the gazetteer never recognized as a
 * place in the first place is unaffected and stays in the query normally.
 *
 * `guardFreeTextWords` (default off): free-text search words can coincide
 * with an obscure real place ("customer success manager" hijacked to Perth
 * because "success" is a real Perth suburb — see resolve-place.ts's
 * `guardCommonWords`). `applyQueryUnderstanding` below turns this on because
 * its `q` is exactly that — typed search words, where a bare common word was
 * never place intent. `resolvePlaces` (agent/tools.ts) leaves it off: the
 * MCP `location` param is explicit place intent, typed into a location
 * field, not a coincidental substring of a role search — "success" there
 * must still resolve.
 */
export async function parsePlaceTokens(
  q: string,
  vocab: LocationVocabulary,
  guardFreeTextWords = false,
): Promise<ParsedPlaces> {
  const { residualQ, resolutions } = scanPlacePhrases(q, vocab.gazetteer, guardFreeTextWords);
  if (resolutions.length === 0) return { residualQ, places: [] };

  const groups = resolutions.flatMap((r) => [r.candidates, r.countryScope]);
  const results = await vocab.corpusChecker(groups);

  const places: PlaceClause[] = [];
  resolutions.forEach((r, i) => {
    const any = results[i * 2];
    if (any.length === 0) return; // nothing this resolution proposed exists in the corpus at all
    const scope = results[i * 2 + 1];
    places.push(scope.length > 0 ? { any, scopedToCountry: scope } : { any });
  });
  return { residualQ, places };
}

/**
 * The board's location box (`commitLocation`, app/jobs/page.tsx) writes the
 * RAW typed text straight into `facets.location_country` — an EXACT-match
 * country facet (`buildFilter`, meilisearch.ts: `location_country = "..."`).
 * Countries only ever appeared to work because Meilisearch's string
 * comparison is case-insensitive; every STATE, CITY or abbreviation silently
 * returned zero against a 1.8M-row corpus ("florida" — reported live
 * 2026-08-08 — where the corpus stores `location_state: "Florida"`,
 * `location_country: "United States"`).
 *
 * Resolving it HERE rather than in the input handler is what makes that a
 * class fix: every caller of `searchJobs` (the first-page search, the
 * infinite-scroll `loadMore`, the ghost/sheet count probes, a deep link or
 * saved-search href parsed back out of the URL) arrives with the same
 * `facets.location_country`, so all of them inherit this by construction and
 * the URL/state shape stays byte-identical.
 *
 * Reuses `parsePlaceTokens` above — the ONE place resolver (gazetteer scan +
 * live corpus validation, so a typed value can never become a filter the
 * corpus can't satisfy, and the filter carries the corpus's OWN casing) —
 * with the common-word guard OFF, the identical call shape `resolvePlaces`
 * (agent/tools.ts) uses for the MCP `location` param: text typed into a
 * location field is explicit place intent, not a coincidental substring of a
 * role search, so "success" must still resolve there (see `parsePlaceTokens`'
 * `guardFreeTextWords` doc).
 *
 * Legacy fallback, deliberately: a value that resolves to NOTHING (gibberish,
 * or a real place this corpus has no postings for) keeps the raw exact facet
 * exactly as before — a verbatim corpus value still works, and nothing that
 * searches today starts failing. All-or-nothing across a multi-value facet
 * (`?location_country=a,b` deep links, /trends' country links): resolved
 * clauses OR together, but a raw facet left standing beside them would AND
 * against that OR-group and zero the search out.
 *
 * Before any place resolution runs, a work-mode pre-pass strips work-mode
 * phrases ("remote", "hybrid", ...) via the SAME `parseWorkTypeTokens` the
 * search box's query text uses, routing them into `work_type` instead of an
 * exact `location_country` value that can never match ("remote" — the
 * location box's own placeholder says "City, state, or remote").
 */
export async function resolveLocationFacet(
  p: JobSearchParams,
  vocab: LocationVocabulary,
): Promise<JobSearchParams> {
  const typed = (p.facets?.location_country ?? []).map((v) => v.trim()).filter(Boolean);
  if (typed.length === 0) return p;

  // Work-mode terms typed into the location box ("remote", "hybrid") are not
  // places — strip them with the SAME parser the search box's query text
  // uses (parseWorkTypeTokens, applyQueryUnderstanding above) before any
  // place resolution runs, so "remote" routes to the work_type facet instead
  // of becoming a location_country filter that can never match ("remote
  // canada" -> work_type: ["remote"] + a Canada place clause — typing it =
  // clicking it, same principle as the query box).
  const stripped = typed.map((phrase) => parseWorkTypeTokens(phrase));
  const workTypes = new Set(stripped.flatMap((s) => s.workTypes));

  if (workTypes.size === 0) {
    // Class case: no work-mode term anywhere in the typed value(s) — the
    // ORIGINAL place-only resolution, untouched, so every existing legacy-
    // fallback guarantee (all-or-nothing across a multi-value facet, a
    // gibberish/uncorroborated value keeping its raw exact facet) still
    // holds byte-for-byte.
    const resolved: PlaceClause[] = [];
    for (const phrase of typed) {
      const { places } = await parsePlaceTokens(phrase, vocab);
      if (places.length === 0) return p;
      resolved.push(...places);
    }
    const { location_country: _raw, ...facets } = p.facets!;
    return { ...p, places: [...(p.places ?? []), ...resolved], facets };
  }

  // At least one phrase carried a work-mode term: resolve whatever place
  // text is left after stripping it. A residual that fails to resolve is
  // simply dropped, not legacy-fallen-back-to — the original phrase
  // ("remote qwerty") contains a work-mode word no location_country value
  // ever holds, so there is no real exact facet left to preserve, and the
  // work-mode facet we DID understand should still apply.
  const resolved: PlaceClause[] = [];
  for (const { residualQ } of stripped) {
    const residual = residualQ.trim();
    if (!residual) continue;
    const { places } = await parsePlaceTokens(residual, vocab);
    resolved.push(...places);
  }

  const { location_country: _raw, ...facets } = p.facets!;
  const mergedWorkTypes = new Set([...(facets.work_type ?? []), ...workTypes]);
  const mergedPlaces = [...(p.places ?? []), ...resolved];
  return {
    ...p,
    // Only attach `places` when there's a resolved clause to carry — a
    // location box that was pure work-mode text ("remote", no residual
    // place words) has nothing to filter on, so leave `places` exactly as
    // it arrived rather than pinning an empty array where `undefined` was.
    ...(mergedPlaces.length > 0 ? { places: mergedPlaces } : {}),
    facets: { ...facets, work_type: [...mergedWorkTypes] },
  };
}

/**
 * Rewrite search params with everything the query text implies:
 * work-type tokens → `work_type` facets (first, so "remote" is consumed as a
 * work mode before the place matcher could see the corpus's junk "Remote"
 * location values), then place tokens → `places` filters.
 *
 * Explicit UI selection always wins: a facet the user already narrowed in
 * the filter panel leaves the corresponding typed tokens in the query
 * untouched rather than second-guessing their click.
 */
export async function applyQueryUnderstanding(
  p: JobSearchParams,
  vocab?: LocationVocabulary,
): Promise<JobSearchParams> {
  const q = (p.q ?? "").trim();
  if (!q) return p;

  let next = p;
  const { residualQ, workTypes } = parseWorkTypeTokens(q);
  if (workTypes.length > 0 && !p.facets?.work_type?.length) {
    next = { ...next, q: residualQ, facets: { ...next.facets, work_type: workTypes } };
  }

  if (vocab && !p.facets?.location_country?.length) {
    const parsed = await parsePlaceTokens((next.q ?? "").trim(), vocab, true);
    if (parsed.places.length > 0) {
      // A query that was ONLY places ("toronto") leaves an empty residual —
      // that's a browse of the place, and `resolveEffectiveSort` (sort.ts)
      // already normalizes relevance-without-query to newest downstream, so
      // no sort override is needed here.
      next = { ...next, q: parsed.residualQ, places: parsed.places };
    }
  }
  return next;
}
