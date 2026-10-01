import { headers } from "next/headers";
import { searchJobsAction } from "@/actions/jobs";
import type { InitialSearch } from "@/app/jobs/JobsContent";
import JobsRouteGate from "@/app/jobs/JobsRouteGate";
import { earlyFirstSearchParams } from "@/lib/jobs/early-first-search";
import { FIRST_ROWS_SEARCH_BUDGET_MS, formatsNumbersLikeServer, isUsableFirstRows } from "@/lib/jobs/server-first-rows";

/**
 * /jobs with its first rows rendered on the server, for a phone opening a
 * search link. Reached only through the middleware's rewrite of `/jobs?q=…`
 * (the address bar keeps that URL; see server-first-rows.ts for who gets
 * it). It runs the first search the list would send from the browser, with
 * the same params, and hands the result to the list, which renders it here
 * and takes it on hydration instead of searching again. Anything short of
 * usable rows in time renders exactly what /jobs does.
 */
export default async function JobsFirstRowsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    return <JobsRouteGate initialSearch={await firstSearch(await searchParams)} />;
}

async function firstSearch(query: Record<string, string | string[] | undefined>): Promise<InitialSearch | null> {
    const h = await headers();
    if (!formatsNumbersLikeServer(h.get("accept-language"))) return null;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        for (const one of [value].flat()) if (one != null) search.append(key, one);
    }
    // The location default a visitor dismissed lives in their browser; the
    // server searches as for a first visit, and the list searches again
    // with the dismissal if params differ (early-first-search.ts).
    const params = earlyFirstSearchParams(`?${search.toString()}`, false);
    if (!params) return null;

    const now = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
        searchJobsAction(params).catch(() => null),
        new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), FIRST_ROWS_SEARCH_BUDGET_MS);
        }),
    ]);
    clearTimeout(timer);
    return result && isUsableFirstRows(result) ? { params, result, now } : null;
}
