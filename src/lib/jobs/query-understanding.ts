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
import type { JobSearchParams, PlaceClause, PlaceFilter } from "./types";
import type { Gazetteer } from "../geo/gazetteer";
import type { CorpusValueChecker } from "../geo/corpus-values";
import { scanPlacePhrases, rebuildAfterRejection, placeClause, type PlaceResolution, type LocationField } from "../geo/resolve-place";
import { MAX_REGION_CLAUSE_TERMS, regionLabel } from "../geo/regions";
import { isMisfiledCountryName } from "../geo/misfiled-country";
import { FUNCTION_WORDS } from "../geo/common-words";
import { SENIORITY_PHRASES } from "./role-title-lane";
import { isNeutralLocationFacetValue, LOCATION_FACET_FIELDS } from "./meilisearch";

export {
  roleTitlePairQueries,
  shouldRunRoleTitleLane,
  titleSatisfiesRoleQuery,
} from "./role-title-lane";

/** Set form of `FUNCTION_WORDS` for O(1) membership checks — built once at
 *  module load, same pattern resolve-place.ts's own GUARD_WORDS uses. */
const FUNCTION_WORDS_SET: Set<string> = new Set(FUNCTION_WORDS);

export { TECH_SKILL_TOKENS, isTechSkillQuery } from "./tech-skills";

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

export interface ParsedSeniority {
  residualQ: string;
  experienceLevels: string[];
}

export function parseSeniorityTokens(q: string): ParsedSeniority {
  let residual = q;
  const found = new Set<string>();
  for (const [re, canonical] of SENIORITY_PHRASES) {
    const next = residual.replace(re, " ");
    if (next !== residual) {
      found.add(canonical);
      residual = next;
    }
  }
  return { residualQ: residual.replace(/\s+/g, " ").trim(), experienceLevels: [...found] };
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
/** Live lookup: does the corpus have a job whose `company` field matches
 *  every word of `phrase`? Backs the S1 company-corroboration guard below —
 *  see `parsePlaceTokens`'s doc. Null-free (unlike `CorpusValueChecker`):
 *  a probe failure degrades to "not corroborated" (`false`), which lets the
 *  place-strip this guard exists to second-guess proceed exactly as it did
 *  before S1 — never blocks a search on an unrelated backend hiccup. */
export type CompanyProbe = (phrase: string) => Promise<boolean>;

export interface LocationVocabulary {
  gazetteer: Gazetteer;
  corpusChecker: CorpusValueChecker;
  companyProbe: CompanyProbe;
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
 *
 * S1 — company corroboration (same `guardFreeTextWords` opt-in): a gazetteer
 * CITY name can also BE an employer's name — "cleveland clinic" resolved
 * "cleveland" to Cleveland the city and left "clinic" prefix-matching any
 * "Clinical ___" job, so zero of the top results were actually Cleveland
 * Clinic the employer (search-audit.md class 1). Only relevant on a
 * MULTI-WORD free-text query (a bare "cleveland" has no adjacent word to
 * corroborate against, and stays a place exactly as before) — see
 * `companyCorroborationCandidates` and the guard below.
 */
export async function parsePlaceTokens(
  q: string,
  vocab: LocationVocabulary,
  guardFreeTextWords = false,
): Promise<ParsedPlaces> {
  const scan = scanPlacePhrases(q, vocab.gazetteer, guardFreeTextWords);
  let { residualQ, resolutions } = scan;
  if (resolutions.length === 0) return { residualQ, places: [] };

  if (guardFreeTextWords && scan.tokens.length > 1) {
    const rejected = new Set<PlaceResolution>();
    await Promise.all(
      resolutions.map(async (r) => {
        for (const candidate of companyCorroborationCandidates(r, scan.tokens)) {
          if (await vocab.companyProbe(candidate)) {
            rejected.add(r);
            return;
          }
        }
      }),
    );
    if (rejected.size > 0) {
      ({ residualQ, resolutions } = rebuildAfterRejection(scan.tokens, resolutions, (r) => rejected.has(r)));
      if (resolutions.length === 0) return { residualQ, places: [] };
    }
  }

  const groups = resolutions.flatMap((r) => [r.candidates, r.countryScope]);
  // Cap only a region's OWN candidates (a continent's OR-list can run well
  // past Meili's IN-list guidance, see MAX_REGION_CLAUSE_TERMS) — its
  // countryScope slot is always empty (regions don't get a country scope,
  // see resolve-place.ts's resolveRegion), and no other entity type has this
  // problem, so every other slot is uncapped.
  const caps = resolutions.flatMap((r) => [r.entity.type === "region" ? MAX_REGION_CLAUSE_TERMS : undefined, undefined]);
  const results = await vocab.corpusChecker(groups, caps);

  const places: PlaceClause[] = [];
  resolutions.forEach((r, i) => {
    const any = results[i * 2];
    if (any.length === 0) return; // nothing this resolution proposed exists in the corpus at all
    const scope = results[i * 2 + 1];
    places.push(placeClause(any, { country: r.entity.type === "country", scopedToCountry: scope.length > 0 ? scope : undefined }));
  });
  return { residualQ, places };
}

/**
 * Pure: which "place token + one adjacent token" phrases to check against
 * the corpus's company field for one place resolution, given the full
 * ORIGINAL token list `scanPlacePhrases` matched it from. Tries the token
 * AFTER the match first ("cleveland CLINIC", "boston CONSULTING" — the
 * common "City Employer-word" shape), then the token BEFORE ("ACME
 * cleveland" — a company name that happens to end in a place word), so a
 * caller that stops at the first true probe checks the likelier case first.
 * Narrow by design — a candidate the corpus's `company` field doesn't
 * recognize is exactly what should stay a place filter, so this never widens
 * beyond the resolution's own immediate neighbors.
 *
 * Skips a neighbor that's a bare function word ("in", "at", "of", ... —
 * `FUNCTION_WORDS`, common-words.ts). Measured live against the box: the
 * jobs index has these configured as Meilisearch STOP WORDS, so a probe for
 * "in dallas" silently degrades to searching for "dallas" alone — which any
 * unrelated Dallas-adjacent company name then falsely "corroborates",
 * defeating the guard for exactly the "warehouse jobs IN dallas" / "jobs IN
 * boston" shape these gates require to stay place filters. A function word
 * never carries corroborating signal on its own, so skipping it costs
 * nothing real — an occupation word like "nurse" (real content, not a
 * function word) is still a usable neighbor.
 */
export function companyCorroborationCandidates(resolution: PlaceResolution, tokens: string[]): string[] {
  const start = resolution.startIndex ?? 0;
  const end = start + resolution.wordsConsumed;
  const span = tokens.slice(start, end).join(" ");
  const isMeaningful = (t: string) => !FUNCTION_WORDS_SET.has(t.toLowerCase());
  const candidates: string[] = [];
  if (end < tokens.length && isMeaningful(tokens[end])) candidates.push(`${span} ${tokens[end]}`);
  if (start > 0 && isMeaningful(tokens[start - 1])) candidates.push(`${tokens[start - 1]} ${span}`);
  return candidates;
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
 * A typed value must never survive as an exact facet predicate with zero
 * corpus support — that's how "North America" (a real phrase, but the corpus
 * has no `location_country = "North America"` row) guaranteed zero results
 * forever (reproduced live 2026-08-26). So a phrase the gazetteer can't fully
 * account for gets ONE more chance: a direct probe of the raw literal
 * against every location facet field (`resolveExactFacetValue`, below), for
 * both the raw-ingest values that are real corpus facts despite naming no
 * GeoNames place ("Worldwide", "EMEA" typed verbatim by an employer's ATS)
 * AND the structured/compound values a picker or deep link hands back
 * verbatim ("US CA San Diego" — see `resolvePhraseOrRawLiteral`'s doc for why
 * tokenizing must be tried, and shown incomplete, before this literal probe
 * ever runs). Only when NEITHER clears does the phrase get dropped —
 * recorded in `unmatchedPlaceMentions` so the caller can tell the searcher,
 * rather than run a predicate guaranteed to return nothing. Each value is
 * judged independently: one bad value in a multi-value facet
 * (`?location_country=a,b` deep links, /trends' country links) no longer
 * poisons the ones that DID resolve.
 *
 * Before any place resolution runs, a work-mode pre-pass strips work-mode
 * phrases ("remote", "hybrid", ...) via the SAME `parseWorkTypeTokens` the
 * search box's query text uses, routing them into `work_type` instead of an
 * exact `location_country` value that can never match ("remote" — the
 * location box's own placeholder says "City, state, or remote").
 */
/**
 * Does the WHOLE typed phrase exactly match a value one of the location
 * facets already carries, across all three fields (`LOCATION_FACET_FIELDS`,
 * meilisearch.ts). Used by `resolvePhraseOrRawLiteral` below only once
 * tokenizing has already shown it can't account for the whole phrase — see
 * that function's doc for why the ordering matters.
 *
 * `matchMode: "literal"` (resolve-place.ts / corpus-values.ts) is what
 * exempts this from PLACE_MIN_COUNT: the candidate isn't a name-derived
 * guess that could coincidentally collide with an ordinary word, it's the
 * verbatim string a searcher already typed or clicked, checked against the
 * corpus's own values — so a low-count city/metro literal is exactly as
 * legitimate a match as a high-count country one.
 */
async function probeFacetFields(
  fields: readonly LocationField[],
  phrase: string,
  vocab: LocationVocabulary,
): Promise<PlaceFilter[]> {
  const [hits] = await vocab.corpusChecker([
    fields.map((field) => ({ field, value: phrase, matchMode: "literal" as const })),
  ]);
  return hits;
}

export async function resolveExactFacetValue(phrase: string, vocab: LocationVocabulary): Promise<PlaceFilter[]> {
  return probeFacetFields(LOCATION_FACET_FIELDS, phrase, vocab);
}

/**
 * Resolve a value that was PICKED from the location typeahead, not typed —
 * the suggestion already names the single field it was advertised on
 * (`SuggestField`, location-suggest.ts: the dropdown row's own count comes
 * from a facet-search against exactly that field). Probing only that field,
 * rather than `resolveExactFacetValue`'s all-three-field OR, is what keeps
 * "advertised count == delivered count": a bare or composite value that
 * happens to also collide with a DIFFERENT field's value (e.g. "San Jose"
 * matching a `location_state` row for Costa Rica's San José province) can
 * never be picked up by a filter that was never asked for.
 *
 * Same `matchMode: "literal"` primitive as `resolveExactFacetValue` — a
 * picked value is an already-advertised corpus literal, so there is no
 * tokenizing/arity question to resolve the way a TYPED phrase has
 * (`resolvePhraseOrRawLiteral` below): a click carries no ambiguity a
 * gazetteer scan could usefully second-guess. "Already-advertised" is a
 * caller-side guarantee, not a URL one — `resolveLocationFacet` screens out
 * the values the typeahead would no longer offer on the field before
 * reaching here (see its picked loop).
 */
export async function resolvePickedFacetValue(
  field: LocationField,
  phrase: string,
  vocab: LocationVocabulary,
): Promise<PlaceFilter[]> {
  return probeFacetFields([field], phrase, vocab);
}

/**
 * Resolve one typed phrase, in three tiers:
 *
 * 1. Tokenize it (`parsePlaceTokens`). Trust that result as-is ONLY when it
 *    consumed the WHOLE phrase (`residualQ` empty) AND resolved to exactly
 *    ONE place — a bare place name ("toronto"), a region ("North America").
 *    A single consumed place is where the gazetteer's generosity (radius-
 *    neighbor padding, cross-country homonym scoping, region member
 *    expansion) is actually wanted, and there is nothing left over to
 *    explain away.
 *
 *    Arity, not completeness, is the discriminator, because those two come
 *    apart: full consumption is evidence the string was DECOMPOSABLE, not
 *    evidence that decomposing it was faithful to what was typed. A
 *    machine-emitted composite built by joining an admin1/country name to a
 *    city ("Massachusetts Boston", "United States Daly City") tokenizes
 *    COMPLETELY into several places with zero residual too — every segment
 *    is independently a real place, but the string as a whole was never
 *    typed by a human meaning "Massachusetts OR Boston". Trusting arity>1
 *    full consumption here would return that fragmented AND-of-places
 *    before ever checking whether the whole phrase is itself a corpus
 *    value (see the test file's "arity gate" block). Gating on arity===1
 *    keeps the bare-word case fast while routing every multi-place
 *    consumption — indistinguishable, at the tokenizer's own level, from
 *    an ordinary compound like "US CA San Diego" — through step 2 below.
 *
 * 2. Anything tokenizing didn't reduce to one clean place — residual text
 *    left over ("US CA San Diego", "Product Manager - Toronto, Canada") OR
 *    multiple places consumed with nothing left over ("Massachusetts
 *    Boston") — gets tried as ONE exact known facet value first
 *    (`resolveExactFacetValue`). A picker or deep link that hands back this
 *    exact string already knows precisely which corpus row it means;
 *    resolving it by literal identity, rather than trusting a
 *    re-derivation the tokenizer had to fragment to produce, is what keeps
 *    that precision intact.
 *
 * 3. No literal match either — fall back to whatever tokenizing DID manage
 *    (today's partial-match behavior, unchanged: "San Diego Renewable
 *    Group" still finds San Diego, "Toronto, Canada" still finds both).
 *    Only when tokenizing found nothing AT ALL does the phrase get dropped
 *    as unmatched.
 */
async function resolvePhraseOrRawLiteral(
  phrase: string,
  vocab: LocationVocabulary,
): Promise<{ places: PlaceClause[]; unmatched: string[] }> {
  const { residualQ, places } = await parsePlaceTokens(phrase, vocab);
  if (places.length === 1 && residualQ.trim() === "") return { places, unmatched: [] };

  const exact = await resolveExactFacetValue(phrase, vocab);
  if (exact.length > 0) {
    // A literal that matched an exact location_country value IS a country
    // filter from the searcher's point of view — explicit picks do not OR in
    // untagged remotes; only the IP default does (placeClause, resolve-place.ts).
    const country = exact.some((f) => f.field === "location_country");
    return { places: [placeClause(exact, { country })], unmatched: [] };
  }

  if (places.length > 0) return { places, unmatched: [] };
  return { places: [], unmatched: [phrase] };
}

/**
 * Every location field OTHER than `location_country` — i.e. the fields a
 * value can only reach `p.facets` on by being PICKED from the typeahead
 * with its field intact (`SuggestField`, addLocation in page.tsx), never by
 * free-typed text (the location box only ever writes `location_country`).
 * Derived from `LOCATION_FACET_FIELDS` (meilisearch.ts) rather than a
 * second literal list, so a future location field is covered here too.
 */
const PICKED_LOCATION_FIELDS = LOCATION_FACET_FIELDS.filter(
  (field): field is Exclude<(typeof LOCATION_FACET_FIELDS)[number], "location_country"> => field !== "location_country",
);

export async function resolveLocationFacet(
  p: JobSearchParams,
  vocab: LocationVocabulary,
): Promise<JobSearchParams> {
  const typedRaw = (p.facets?.location_country ?? []).map((v) => v.trim()).filter(Boolean);
  // Widen sentinels (`any`/`all`, same set as `canonicalFacetValues` in
  // meilisearch.ts) are not place phrases — drop them before resolution so
  // they are not gazetteer/literal-probed. When nothing real remains, leave
  // `p` intact so `hasLocationSignal` stays true and `buildFilter` strips
  // the sentinel at filter-build time.
  const typed = typedRaw.filter((v) => !isNeutralLocationFacetValue(v));
  // Picked city/state suggestions: each already names its own field, so it
  // resolves as one exact literal on that field alone (`resolvePickedFacetValue`)
  // rather than through the gazetteer/work-mode pipeline below, which exists
  // to disambiguate free-typed TEXT — a click already answered that question.
  const picked = PICKED_LOCATION_FIELDS.flatMap((field) =>
    (p.facets?.[field] ?? []).map((v) => v.trim()).filter(Boolean).map((value) => ({ field, value })),
  );
  if (typed.length === 0 && picked.length === 0) return p;

  // Work-mode terms typed into the location box ("remote", "hybrid") are not
  // places — strip them with the SAME parser the search box's query text
  // uses (parseWorkTypeTokens, applyQueryUnderstanding above) before any
  // place resolution runs, so "remote" routes to the work_type facet instead
  // of becoming a location_country filter that can never match ("remote
  // canada" -> work_type: ["remote"] + a Canada place clause — typing it =
  // clicking it, same principle as the query box).
  const stripped = typed.map((phrase) => parseWorkTypeTokens(phrase));

  // Each phrase's work modes are bound to the places THAT phrase resolved
  // to, rather than pooled into one global facet. Pooling is what made
  // ["remote canada", "hybrid united states"] mean
  //   (remote OR hybrid) AND (Canada OR US)
  // — which also returns remote US roles nobody asked for. Bound, it means
  //   (Canada AND remote) OR (US AND hybrid)
  // which is the question that was actually asked. For a SINGLE phrase with
  // no work-mode term the two forms are logically identical, so this is also
  // the whole story for the plain single-location case.
  const resolved: PlaceClause[] = [];
  const unboundWorkTypes = new Set<string>();
  const unmatched: string[] = [];
  for (const { residualQ, workTypes: phraseWorkTypes } of stripped) {
    const residual = residualQ.trim();
    if (!residual) {
      // Pure work-mode text ("remote") — nothing to resolve, mode stays global.
      for (const t of phraseWorkTypes) unboundWorkTypes.add(t);
      continue;
    }
    const { places, unmatched: miss } = await resolvePhraseOrRawLiteral(residual, vocab);
    if (places.length === 0) {
      // Neither the gazetteer nor a direct corpus probe recognized it — its
      // work mode (if any) stays global rather than being dropped with it,
      // and the phrase itself is recorded as unmatched (see the module doc).
      for (const t of phraseWorkTypes) unboundWorkTypes.add(t);
      unmatched.push(...miss);
      continue;
    }
    resolved.push(
      ...places.map((clause) =>
        phraseWorkTypes.length > 0 ? { ...clause, workTypes: [...phraseWorkTypes] } : clause,
      ),
    );
  }

  // Picked values resolve independently of the typed/country ones above —
  // literal probe only, no work-mode binding (a picked place can never carry
  // typed-in work-mode text) — and fold into the SAME `resolved`/`unmatched`
  // accumulators, so they OR together with any typed places via the one
  // `p.places` merge below (`JobSearchParams.places` is already OR-across-
  // mentions by construction — see its doc).
  for (const { field, value } of picked) {
    // …with ONE carve-out: a value the SUGGESTION chokepoint would refuse to
    // offer on this field is not a real pick, whatever the URL says. Old deep
    // links, browser history and saved searches still carry the ones the
    // dropdown used to emit — a region under CITIES (`?city=North+America`)
    // or a country name an ATS stuffed into a city/state field
    // (`?city=Canada`, 31 rows beside Countries·Canada's 66,010) — and a
    // literal probe honours them exactly, which is precisely the near-empty
    // result those links produce today. Routing them back through the TYPED
    // pipeline recovers the meaning the label always had: region → its member
    // countries, country name → the country.
    //
    // The two predicates are the same ones `mergeFieldHits` (location-suggest)
    // filters with, so the invariant holds by construction rather than by
    // maintenance: resolution honours literally exactly the set of values
    // suggestion would still offer. Neither predicate can catch a legitimate
    // homonym pick — `regionLabel` reads a closed alias table, and
    // `isMisfiledCountryName` demands positive gazetteer evidence that the
    // value is a country AND is NOT a city/admin1 (States·Georgia and
    // Cities·Mexico stay literal on both sides).
    if (regionLabel(value) || isMisfiledCountryName(field, value, vocab.gazetteer)) {
      const { places, unmatched: miss } = await resolvePhraseOrRawLiteral(value, vocab);
      resolved.push(...places);
      unmatched.push(...miss);
      continue;
    }
    const hits = await resolvePickedFacetValue(field, value, vocab);
    if (hits.length === 0) {
      unmatched.push(value);
      continue;
    }
    // Never a country filter by construction — `field` is drawn from
    // `PICKED_LOCATION_FIELDS`, which excludes `location_country`.
    resolved.push(placeClause(hits, { country: false }));
  }

  // Every location field this function resolves is stripped from the
  // generic facets bag the same way — left standing, a raw picked literal
  // would AND against the resolved `places` clause it now lives in instead
  // (`buildFilter`'s per-key loop is AND-across-keys) and zero the search
  // out. `LOCATION_FACET_FIELDS` is the single source of truth for which
  // keys those are, so a new location field is covered here by construction.
  const facets = { ...p.facets! };
  for (const field of LOCATION_FACET_FIELDS) delete facets[field];
  // The dropdown's own work_type selection is a DIFFERENT question ("remote
  // anywhere") from one typed into a place phrase ("remote in Canada"), so
  // it stays global and still AND's across the whole query.
  const mergedWorkTypes = new Set([...(facets.work_type ?? []), ...unboundWorkTypes]);
  const mergedPlaces = [...(p.places ?? []), ...resolved];
  return {
    ...p,
    // Only attach `places` when there's a resolved clause to carry — a
    // location box that resolved to nothing at all has nothing to filter
    // on, so leave `places` exactly as it arrived rather than pinning an
    // empty array where `undefined` was.
    ...(mergedPlaces.length > 0 ? { places: mergedPlaces } : {}),
    // Likewise only write `work_type` when something global remains: with
    // every typed mode now bound to its own place, this set is often empty,
    // and writing `[]` where the caller had `undefined` would be a change
    // of shape for no change of meaning.
    facets: mergedWorkTypes.size > 0 ? { ...facets, work_type: [...mergedWorkTypes] } : facets,
    // Every typed value that named nothing this corpus can filter on — never
    // silently dropped, so the caller can tell the searcher instead of
    // running a predicate guaranteed to return zero rows (see
    // src/lib/jobs/result-state.ts's unmatchedPlaceNote).
    ...(unmatched.length > 0
      ? { unmatchedPlaceMentions: [...(p.unmatchedPlaceMentions ?? []), ...unmatched] }
      : {}),
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

  const explicitWorkType = (p.facets?.work_type?.length ?? 0) > 0;
  let next = p;
  const { residualQ, workTypes } = parseWorkTypeTokens(q);
  if (workTypes.length > 0 && !explicitWorkType) {
    next = { ...next, q: residualQ };
  }

  if (vocab && !p.facets?.location_country?.length) {
    const parsed = await parsePlaceTokens((next.q ?? "").trim(), vocab, true);
    if (parsed.places.length > 0) {
      const places =
        workTypes.length > 0 && !explicitWorkType
          ? parsed.places.map((clause) => ({ ...clause, workTypes: [...workTypes] }))
          : parsed.places;
      next = { ...next, q: parsed.residualQ, places };
    }
  }

  if (workTypes.length > 0 && !explicitWorkType && !(next.places?.length ?? 0)) {
    next = { ...next, facets: { ...next.facets, work_type: workTypes } };
  }

  return next;
}
