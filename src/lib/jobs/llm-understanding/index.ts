import { isDeepStrictEqual } from "node:util";
import { DEFAULT_MODEL, FREE_LADDER } from "@/lib/llm/models";
import { resolveModelLadder } from "@/lib/llm/model-ladder";
import { liveRungs } from "@/lib/llm/live-rungs";
import { placeClause } from "@/lib/geo/resolve-place";
import { parseQuotedOrPhrases } from "../fit-phrases";
import { resolveExactFacetValue, type LocationVocabulary } from "../query-understanding";
import type { JobSearchParams, PlaceClause } from "../types";
import { applyIntent } from "./intent-to-params";
import { defaultIntentCache, parseIntent, type ParseDeps } from "./parse";
import { EMPTY_INTENT, type JobSearchIntent } from "./schema";

export interface LlmUnderstandingDeps {
    /** Needed to resolve the intent's location against the corpus; without it a location is mentioned, not filtered. */
    vocab?: LocationVocabulary;
    parse?: ParseDeps;
}

/** Anonymous search must not require sign-in, so this does NOT go through
 *  `resolveLLMConfig` (which does): it reads the shared key directly and
 *  `parseIntent` only ever walks the free rungs. A missing key just fails
 *  every rung, and the deterministic result stands. */
async function defaultParseDeps(): Promise<ParseDeps> {
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    return {
        rungs: await liveRungs(resolveModelLadder({ provider: "openrouter", model: DEFAULT_MODEL }, FREE_LADDER)),
        cache: defaultIntentCache,
        generate: async (rung, prompt) => {
            const { ProviderFactory } = await import("@/lib/llm/providers");
            const r = await ProviderFactory.getProvider("openrouter", apiKey, rung.model).generate({
                prompt,
                system: "Return ONLY valid JSON.",
                json: true,
                timeoutMs: rung.timeoutMs,
                maxRetries: 1,
            });
            if (r.error) throw new Error(r.error);
            return r.text;
        },
    };
}

/** Two words or a digit: a lone word is already handled by Meili synonyms and typo tolerance. */
function worthParsing(p: JobSearchParams): boolean {
    const q = (p.q ?? "").trim();
    if (!q || p.id || parseQuotedOrPhrases(q)) return false;
    return q.split(/\s+/).length >= 2 || /\d/.test(q);
}

/** The first of city/state/country the corpus has a literal value for, as one place clause. */
async function resolveIntentPlace(loc: JobSearchIntent["location"], vocab: LocationVocabulary): Promise<PlaceClause[]> {
    for (const phrase of [loc.city, loc.state, loc.country]) {
        const any = phrase ? await resolveExactFacetValue(phrase, vocab) : [];
        if (any.length) return [placeClause(any, { label: phrase ?? undefined })];
    }
    return [];
}

/**
 * Pipeline stage after `applyQueryUnderstanding`: send the RESIDUAL query text
 * through the free LLM rungs and write what comes back into the params. Any
 * failure (every rung down, empty answer) returns `p` untouched, so the
 * deterministic result still searches.
 */
export async function applyLlmUnderstanding(p: JobSearchParams, deps: LlmUnderstandingDeps = {}): Promise<JobSearchParams> {
    if (!worthParsing(p)) return p;
    const parsed = await parseIntent(p.q ?? "", deps.parse ?? await defaultParseDeps());
    if (!parsed || isDeepStrictEqual(parsed.intent, EMPTY_INTENT)) return p;
    const { location } = parsed.intent;
    const needsPlace = Boolean(location.city || location.state || location.country) && !p.places?.length && !p.facets?.location_country?.length;
    const places = needsPlace && deps.vocab ? await resolveIntentPlace(location, deps.vocab) : [];
    return applyIntent(p, parsed.intent, places);
}
