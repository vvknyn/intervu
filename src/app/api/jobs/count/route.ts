/**
 * GET /api/jobs/count?<same params /jobs takes: q, country, posted, …> — the
 * search-recall canary's "served" door (SPEC §6,
 * SPEC-tiered-retrieval-and-recall-canary.md, Fable decision Sep 10 17:40).
 *
 * No JSON search route existed on origin/main before this PR (only
 * /api/jobs/locations, /api/jobs/suggest) — HTML-scraping /jobs for a canary
 * check would be brittle, and reimplementing `/jobs`'s scope logic in the
 * checker would be a test derived from the code it's meant to catch
 * regressions in. This route goes through the SAME parser
 * (`parseJobsUrl`) + payload builder (`buildJobSearchPayload`) + company-
 * intent resolution (`resolveCompanyIntentResult`/`applyCompanyDomainPin`)
 * + bare-role-query classifier (`isBareRoleQuery`) that `/jobs` itself uses,
 * so the canary observes exactly the scope `/jobs` would apply — never its
 * own approximation of it.
 *
 * `titled`/`wholeDoc` are ALWAYS measured independently via two genuine
 * limit-0 `runCountPass` calls, regardless of `mechanism` — never derived
 * from each other or from `total` (the lying-fallback shape that bug would
 * take: reusing `searchMeili`'s zero-hit-relax total, which silently stays 0
 * when both the strict and expand passes are limit-0 and so never populate
 * `mergeExpandedIntoStrict`'s `extras`). `total` is the one ANSWER — routed
 * through `resolveHeadlineTotal`, the same presentation chokepoint `/jobs`
 * uses for its headline count — so the two callers can never disagree about
 * which of `titled`/`wholeDoc` is "the" total for a given query.
 *
 * Lane-triggering queries (`shouldRunRoleTitleLane`/
 * `shouldRunCompanyScopedLanes`) are NOT specially handled here — this
 * route's `titled`/`wholeDoc`/`total` are always the plain strict/whole-
 * document counts for the resolved search params, never the lane's own
 * hit-fetch total. None of SPEC §6's benchmark pairs are lane-triggering
 * queries, and a cheap limit-0 count pass is what the canary needs; the lane
 * mechanism exists for /jobs's ranked-hit display, not for a total.
 *
 * No auth (SPEC §6): the canary is an unauthenticated ops probe. Every count
 * is a `limit: 0` search — no hits are ever fetched or returned.
 */
import { NextResponse } from "next/server";
import { applyCompanyDomainPin } from "@/lib/jobs/company-intent";
import {
    host,
    isBareRoleQuery,
    resolveCompanyIntentResult,
    runCountPass,
    shouldRelaxSearch,
} from "@/lib/jobs/meilisearch";
import { resolveHeadlineTotal } from "@/lib/jobs/presentation";
import { buildJobSearchPayload } from "@/lib/jobs/search-payload";
import { isPostedDateFilterSupported } from "@/lib/jobs/search";
import { parseJobsUrl, urlSortToMode } from "@/lib/jobs/url-state";

/**
 * The one place this route decides which count is `total` — pulled out of
 * `GET` so the decision is unit-testable without mocking the whole request
 * pipeline (posted-date-support probe, company-intent probe, two live
 * `runCountPass` calls). `tiered` routes through `resolveHeadlineTotal`
 * (the same chokepoint `/jobs`'s headline uses); `strict` must apply the
 * SAME relax rule the SERP falls back on (`shouldRelaxSearch`, meilisearch.ts)
 * rather than unconditionally reporting `titled` — `/jobs` relaxes to the
 * whole-document pass when the strict pass comes back empty, so a strict
 * query with titled=0 has to report `wholeDoc` here too, or this canary and
 * the page it's checking disagree on a zero-hit query.
 */
export function resolveCountRouteTotal(
    mechanism: "tiered" | "strict",
    titled: number,
    wholeDoc: number,
    q: string,
): number {
    return mechanism === "tiered"
        ? resolveHeadlineTotal({ total: wholeDoc, tier1Total: titled })
        : shouldRelaxSearch(titled, q)
          ? wholeDoc
          : titled;
}

export async function GET(request: Request): Promise<NextResponse> {
    const sp = new URL(request.url).searchParams;
    const urlState = parseJobsUrl(sp);
    if (!urlState.q.trim()) {
        return NextResponse.json({ error: "q required" }, { status: 400 });
    }

    const h = host();
    if (!h) {
        return NextResponse.json({ error: "meilisearch not configured" }, { status: 503 });
    }

    // `null` ("couldn't determine") defaults to supported — the same
    // optimistic posture /jobs itself takes (`useState(true)` in page.tsx)
    // until told otherwise, so this route's 30d default matches /jobs's.
    const postedDateSupported = (await isPostedDateFilterSupported()) !== false;
    // "fit" (résumé-ranked) has no meaning without the résumé state /jobs's
    // page component owns — same "fit collapses to no explicit sort" posture
    // page.tsx's own `resolveUrlSort` takes, via the same `urlSortToMode`
    // single source of truth for the UrlSort → JobSortMode mapping.
    const sortMode = urlState.sort ? urlSortToMode(urlState.sort) : null;
    const payload = buildJobSearchPayload(
        urlState,
        urlState.q,
        sortMode === "fit" ? undefined : sortMode,
        postedDateSupported,
    );

    const intent = await resolveCompanyIntentResult(payload.q);
    const companyScoped = intent.companyScoped;
    const searchParams = applyCompanyDomainPin(payload, intent);
    const mechanism: "tiered" | "strict" = isBareRoleQuery(searchParams.q ?? "", companyScoped)
        ? "tiered"
        : "strict";

    const [titled, wholeDoc] = await Promise.all([
        runCountPass(h, searchParams, { companyScoped }),
        runCountPass(h, searchParams, { companyScoped, wholeDocument: true }),
    ]);
    const total = resolveCountRouteTotal(mechanism, titled, wholeDoc, searchParams.q ?? "");

    return NextResponse.json(
        {
            q: urlState.q,
            country: sp.get("country"),
            posted: urlState.postedBucket ?? "any",
            total,
            titled,
            wholeDoc,
            mechanism,
        },
        { headers: { "Cache-Control": "no-store" } },
    );
}
