/**
 * One account's daily picks, read on the server the way Today reads them in
 * the browser (TodayHome.tsx): the same résumé and saved preferences
 * (`resolveCandidateSignals(resume, withPlaceCountries(prefs))`, as every
 * fit on the site and the MCP tools is scored), the same search (the
 * résumé's own pack, `packFilters`, limited to the week, `TODAY_PICKS_FETCH_LIMIT`
 * rows), the same score (`scoreJobAgainstResume`) and the same pick rules
 * (`rankDailyPicks` → `pickToday`).
 *
 * It works only from the structured résumé the account saved. A résumé saved
 * as text alone is never structured here: résumé reading stays in the
 * browser, as the privacy promises say (privacy-promises.ts). Nothing here
 * calls an AI, and the search is the server's own (`searchJobs`), which never
 * writes to the search log.
 *
 * I/O is injected (`DailyPicksDeps`, a subset of the MCP tools' `ToolDeps`),
 * so the daily run and the `daily_picks` tool share this and tests can feed it.
 */
import { trackedIndex } from "@/lib/pursuits/applied";
import { resolveCandidateSignals, type CandidateSignals } from "@/lib/jobs/candidate-signals";
import { locationDropped } from "@/lib/jobs/broaden";
import { packFilters, packSearchParams } from "@/lib/jobs/for-you/pack-filters";
import { TODAY_PICKS_FETCH_LIMIT, TODAY_PICKS_WINDOW_MS, type TodayRole } from "@/lib/jobs/for-you/today";
import type { JobSearchParams, JobSearchResult } from "@/lib/jobs/types";
import type { LocationReport } from "@/lib/jobs/broaden";
import type { AgentPreferences } from "@/lib/agent/preferences";
import { withPlaceCountries } from "@/lib/agent/place-countries";
import type { ApplicationSummary } from "@/lib/pursuits/list";
import type { BaseResume } from "@/lib/resume/base-resume";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { scoreJobAgainstResume } from "@/lib/match/score";
import type { ResumeData } from "@/types/resume";
import { chooseDailyPicks, rankDailyPicks, type DailyPicksSent } from "./pick";

export interface DailyPicksDeps {
    getBaseResume: (uid: string) => Promise<BaseResume>;
    getPreferences: (uid: string) => Promise<AgentPreferences>;
    /** The site's list search, with description places on its rows (`searchAsTheSite`). */
    search: (params: JobSearchParams) => Promise<JobSearchResult>;
    listApplications: (uid: string, opts: { limit: number }) => Promise<ApplicationSummary[]>;
}

/** Tracked roles read to keep them out of the picks: well past any real tracker. */
const TRACKED_READ_LIMIT = 1_000;

/** Why there is nothing to rank: no résumé saved, one saved as text only, or one with no role or skills to read. */
export type DailyPicksNoResume = "none" | "text-only" | "unusable";

export type DailyPicksResult =
    | {
          kind: "ready";
          resume: ResumeData;
          signals: CandidateSignals;
          /** Every pick this week, best first; roles already emailed come after the rest. */
          ranked: TodayRole[];
          /** The next email's roles: the best not emailed before (`chooseDailyPicks`). */
          picks: TodayRole[];
      }
    | { kind: "no-resume"; reason: DailyPicksNoResume }
    | { kind: "unavailable" };

export async function collectDailyPicks(
    uid: string,
    deps: DailyPicksDeps,
    opts: { nowMs: number; sent: DailyPicksSent },
): Promise<DailyPicksResult> {
    const base = await deps.getBaseResume(uid);
    if (base.source === "none") return { kind: "no-resume", reason: "none" };
    if (base.source === "resume_text") return { kind: "no-resume", reason: "text-only" };
    const resume = base.resume_data;
    if (!resumeIsUsable(resume)) return { kind: "no-resume", reason: "unusable" };

    const [prefs, applications] = await Promise.all([
        deps.getPreferences(uid),
        deps.listApplications(uid, { limit: TRACKED_READ_LIMIT }),
    ]);
    const signals = resolveCandidateSignals(resume, withPlaceCountries(prefs));
    const pack = packFilters(resume, signals);

    const result = await deps.search({
        ...packSearchParams(pack, signals, { resume }),
        postedSinceMs: opts.nowMs - TODAY_PICKS_WINDOW_MS,
        limit: TODAY_PICKS_FETCH_LIMIT,
        offset: 0,
        withFacets: false,
    });
    // A search that failed must never read as "nothing new today".
    if (result.unavailable === true || !result.configured) return { kind: "unavailable" };

    // The pack's location is where they can work: a search that dropped it matched nothing there.
    const hits = locationDropped(pack, result as JobSearchResult & LocationReport) ? [] : result.hits;
    const roles: TodayRole[] = [];
    for (const job of hits) {
        // One malformed row must not cost the person their whole email (TodayHome skips it the same way).
        let score: TodayRole["score"] | null = null;
        try {
            score = scoreJobAgainstResume(resume, job, signals);
        } catch {
            score = null;
        }
        if (score) roles.push({ job, score });
    }

    const tracked = new Set(applications.map((a) => a.job_id).filter((id): id is string => Boolean(id)));
    // Applied roles stay out when the same opening comes back under a new id, too (lib/pursuits/applied.ts).
    const ranked = rankDailyPicks(roles, { tracked, sent: opts.sent, applied: trackedIndex(applications) });
    return { kind: "ready", resume, signals, ranked, picks: chooseDailyPicks(ranked, opts.sent) };
}
