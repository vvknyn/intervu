"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { JOBS_FETCHED_PER_FOLLOW_DOMAIN } from "@/lib/follows/alerts";
import { listNewRolesForFollows } from "@/lib/follows/list-new-roles";
import { docToFollowedCompany, followedCompaniesCollection } from "@/lib/follows/store";
import {
    NEEDS_YOU_MAX_FOLLOWS,
    NEEDS_YOU_MAX_SAVED_ROLES,
    NEEDS_YOU_MAX_SAVED_SEARCHES,
    type NeedsYouRemote,
} from "@/lib/jobs/for-you/needs-you";
import { listUnlistedJobIds } from "@/lib/jobs/get-job";
import { JOBS_FETCHED_PER_SAVED_SEARCH, listNewRolesForSavedSearch } from "@/lib/jobs/saved-search-new-roles";
import { jobsUrlStateFromSavedHref, savedSearchBoardHref } from "@/lib/jobs/saved-searches";
import { docToSavedSearch, savedSearchesCollection } from "@/lib/jobs/saved-searches-store";
import { logServer, scrubMessage } from "@/lib/observability/posthog-logs";
import { allowNeedsYouRequest } from "@/lib/shield/rate-limit";

const DAY_MS = 86_400_000;
/** The furthest back "new since" reaches, whatever the client sends. */
const MAX_LOOKBACK_MS = 30 * DAY_MS;

/**
 * The account side of the packs home's "Needs you": new roles since the
 * visitor's last visit from their saved searches and followed companies
 * (the digest's own helpers, `listNewRolesForSavedSearch` and
 * `listNewRolesForFollows`), and which of their saved roles' listings have
 * closed. Signed-in only; a guest's list is their local tracker alone.
 *
 * Each part fails on its own: a failed follow read leaves the saved
 * searches, and the other way round. Only the account reads failing is an
 * error.
 */
export async function listNeedsYouAction(input: {
    sinceIso: string;
    savedJobIds: string[];
}): Promise<{ data?: NeedsYouRemote; error?: string }> {
    // Each refusal says why in the server log: the panel's "We can't check
    // your saved searches" used to leave no trace of which one it was.
    const user = await getServerUser();
    if (!user) {
        logServer("warn", "needs-you read refused", { reason: "signed_out" });
        return { error: "User not authenticated" };
    }
    if (!allowNeedsYouRequest(user.uid)) {
        logServer("warn", "needs-you read refused", { reason: "rate_limited" });
        return { error: "Too many requests" };
    }

    const now = Date.now();
    const since = Date.parse(input.sinceIso);
    const sinceIso = new Date(Number.isNaN(since) ? now - 7 * DAY_MS : Math.min(now, Math.max(since, now - MAX_LOOKBACK_MS))).toISOString();
    const savedJobIds = [...new Set((Array.isArray(input.savedJobIds) ? input.savedJobIds : []).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(
        0,
        NEEDS_YOU_MAX_SAVED_ROLES,
    );

    let follows;
    let savedSearches;
    try {
        const [followSnap, searchSnap] = await Promise.all([
            followedCompaniesCollection(user.uid).orderBy("createdAt", "desc").get(),
            savedSearchesCollection(user.uid).orderBy("createdAt", "desc").get(),
        ]);
        follows = followSnap.docs.map(docToFollowedCompany);
        savedSearches = searchSnap.docs.map(docToSavedSearch);
    } catch (error) {
        console.error("Error reading needs-you sources:", error);
        logServer("warn", "needs-you read refused", {
            reason: "store_read_failed",
            "error.code": String((error as { code?: unknown })?.code ?? ""),
            "error.message": scrubMessage(error instanceof Error ? error.message : String(error)),
        });
        return { error: "Failed to load" };
    }

    const [followGroups, searchCounts, closedJobIds] = await Promise.all([
        listNewRolesForFollows(sinceIso, follows.slice(0, NEEDS_YOU_MAX_FOLLOWS)).catch(() => []),
        Promise.all(
            savedSearches.slice(0, NEEDS_YOU_MAX_SAVED_SEARCHES).map(async (s) => {
                const jobs = await listNewRolesForSavedSearch(sinceIso, jobsUrlStateFromSavedHref(s.href)).catch(() => []);
                return { id: s.id, name: s.name, href: savedSearchBoardHref(s.href), count: jobs.length, more: jobs.length >= JOBS_FETCHED_PER_SAVED_SEARCH };
            }),
        ),
        listUnlistedJobIds(savedJobIds).catch(() => [] as string[]),
    ]);

    const slugByDomain = new Map(follows.map((f) => [f.domain, f.slug]));
    return {
        data: {
            searches: searchCounts,
            follows: followGroups.map((g) => ({
                domain: g.domain,
                name: g.displayName,
                slug: slugByDomain.get(g.domain) || g.domain,
                count: g.jobs.length,
                more: g.jobs.length >= JOBS_FETCHED_PER_FOLLOW_DOMAIN,
            })),
            closedJobIds,
            savedSearchCount: savedSearches.length,
            followCount: follows.length,
        },
    };
}
