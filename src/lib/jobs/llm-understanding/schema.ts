import { z } from "zod";
import { EMPLOYMENT_TYPES, EXPERIENCE_LEVELS, WORK_TYPES } from "@/lib/agent/facets";

/**
 * The LLM's output contract for one search sentence. Every field degrades on
 * its own (`.catch`): a model that gets one field wrong costs that field, not
 * the parse. The enums come from `lib/agent/facets` — the vocabularies the
 * facet filters are written in — so a value the model invents can never reach
 * a filter.
 */
const strings = z.array(z.string()).catch([]);
const nullable = <T extends z.ZodType>(s: T) => s.nullable().catch(null);

export const JobSearchIntent = z.object({
    titles: strings,
    terms: strings,
    work_mode: nullable(z.enum(WORK_TYPES)),
    employment_type: nullable(z.enum(EMPLOYMENT_TYPES)),
    location: z
        .object({ country: nullable(z.string()), state: nullable(z.string()), city: nullable(z.string()) })
        .catch({ country: null, state: null, city: null }),
    min_salary: z
        .object({ amount: nullable(z.number().positive()), currency: nullable(z.string()) })
        .catch({ amount: null, currency: null }),
    min_years: nullable(z.number().int().nonnegative()),
    experience_level: nullable(z.enum(EXPERIENCE_LEVELS)),
    posted_within_days: nullable(z.number().int().positive()),
    exclude_titles: strings,
    unparsed: strings,
});
export type JobSearchIntent = z.infer<typeof JobSearchIntent>;

export const EMPTY_INTENT: JobSearchIntent = JobSearchIntent.parse({});

/** Never throws: anything that is not an object degrades to `EMPTY_INTENT`. */
export function safeParseIntent(raw: unknown): JobSearchIntent {
    const r = JobSearchIntent.safeParse(raw);
    return r.success ? r.data : EMPTY_INTENT;
}
