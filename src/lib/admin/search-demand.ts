/**
 * The admin "Search demand" view: what people search for, what finds nothing
 * or too little, which places come up empty, and which employers they name
 * that have no open roles here. The ingest list for the crawl starts here.
 *
 * Read from the anonymous search log (`lib/jobs/search-log.ts`): no account,
 * IP or browser id, and résumé-built searches (Rank by fit, For you, Today)
 * are never written to it, so nothing here describes one person.
 *
 * Pure: rows in, lists out. The read is `collectSearchDemand`
 * (search-demand-collect.ts), so this file is safe for the client view to
 * import for its types.
 */
import { THIN_RESULTS_BELOW } from "@/lib/jobs/broaden";

/** The fields of one logged search the view reads. */
export interface DemandRow {
    q?: string;
    resultCount?: number;
    unavailable?: boolean;
    places?: string[];
    defaultedCountry?: string;
    unmatchedPlaces?: string[];
    company?: string;
    missedCompanies?: string[];
}

export interface DemandQuery {
    query: string;
    searches: number;
    /** Median result count over this query's searches. */
    typicalResults: number;
}

export interface DemandCount {
    label: string;
    searches: number;
    /** Of those, how many came back with fewer than THIN_RESULTS_BELOW results. */
    fewOrNone: number;
}

export interface SearchDemand {
    windowDays: number;
    /** Searches read: every logged search in the window, failed ones included. */
    searches: number;
    /** The backend was down: not counted in any result-based number. */
    failed: number;
    /** Share of answered searches with no results, and with fewer than THIN_RESULTS_BELOW. */
    noneShare: number;
    fewShare: number;
    thinBelow: number;
    popular: DemandQuery[];
    /** Queries whose typical search finds nothing. */
    nothingFound: DemandQuery[];
    /** Queries whose typical search finds 1 to THIN_RESULTS_BELOW - 1. */
    fewFound: DemandQuery[];
    /** Where searches looked: the place picked, else the visitor's country. */
    places: DemandCount[];
    /** Places typed that the index has no roles in at all. */
    missingPlaces: DemandCount[];
    /** Employers searched by name, or a company page searched, that came back thin. */
    companies: DemandCount[];
    /** True when the window held more rows than the read takes. */
    truncated: boolean;
}

/** How many entries each list shows. */
export const DEMAND_LIST_SIZE = 15;

/** Pure: one spelling per query, so "Nurse " and "nurse" count together. */
export function normalizeDemandQuery(q: string | undefined): string {
    return (q ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function bump(map: Map<string, DemandCount>, label: string, thin: boolean): void {
    const key = label.trim().toLowerCase();
    if (!key) return;
    const entry = map.get(key) ?? { label: label.trim(), searches: 0, fewOrNone: 0 };
    entry.searches += 1;
    if (thin) entry.fewOrNone += 1;
    map.set(key, entry);
}

function top<T extends { searches: number }>(items: Iterable<T>, by: (item: T) => number = (item) => item.searches): T[] {
    return [...items].sort((a, b) => by(b) - by(a) || b.searches - a.searches).slice(0, DEMAND_LIST_SIZE);
}

function share(part: number, whole: number): number {
    return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

/** Pure: the demand lists for one window of logged searches. */
export function summarizeSearchDemand(rows: readonly DemandRow[], windowDays: number, truncated = false): SearchDemand {
    const byQuery = new Map<string, number[]>();
    const places = new Map<string, DemandCount>();
    const missingPlaces = new Map<string, DemandCount>();
    const companies = new Map<string, DemandCount>();
    let failed = 0;
    let none = 0;
    let few = 0;

    for (const row of rows) {
        if (row.unavailable) {
            failed += 1;
            continue;
        }
        const results = typeof row.resultCount === "number" ? row.resultCount : 0;
        const thin = results < THIN_RESULTS_BELOW;
        if (results === 0) none += 1;
        else if (thin) few += 1;

        const query = normalizeDemandQuery(row.q);
        if (query) byQuery.set(query, [...(byQuery.get(query) ?? []), results]);

        const where = row.places?.length ? row.places : row.defaultedCountry ? [row.defaultedCountry] : [];
        for (const place of where) bump(places, place, thin);
        for (const place of row.unmatchedPlaces ?? []) bump(missingPlaces, place, true);

        const named = new Set([...(row.missedCompanies ?? []), ...(row.company && thin ? [row.company] : [])]);
        for (const company of named) bump(companies, company, true);
    }

    const queries: DemandQuery[] = [...byQuery].map(([query, counts]) => ({
        query,
        searches: counts.length,
        typicalResults: median(counts),
    }));
    const answered = rows.length - failed;

    return {
        windowDays,
        searches: rows.length,
        failed,
        noneShare: share(none, answered),
        fewShare: share(few, answered),
        thinBelow: THIN_RESULTS_BELOW,
        popular: top(queries),
        nothingFound: top(queries.filter((q) => q.typicalResults === 0)),
        fewFound: top(queries.filter((q) => q.typicalResults > 0 && q.typicalResults < THIN_RESULTS_BELOW)),
        places: top(places.values()),
        missingPlaces: top(missingPlaces.values()),
        companies: top(companies.values()),
        truncated,
    };
}
