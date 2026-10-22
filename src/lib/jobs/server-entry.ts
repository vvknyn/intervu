/**
 * The server decides /jobs' first frame for a signed-in visitor.
 *
 * The server already holds, at request time, who is signed in, whether a
 * résumé is on file and the résumé-ranked search it would open. The browser
 * used to rediscover each through serialized server actions and paint a wrong
 * frame after every step: the bare shell, "Loading your session…", the
 * signed-out front door, then the swap to the fit search. The rule: whatever
 * decides the first frame is resolved here and handed to the page as props;
 * the client never discovers first-frame state.
 *
 * Pure decisions only; `app/jobs/page.tsx` does the reads.
 */
import type { ServerUser } from "@/lib/auth/workos-identity";
import { RESUME_IMPORTER_PARAM } from "@/lib/auth/post-auth-destination";
import { DEFAULT_URL_STATE, parseJobsUrl, serializeJobsUrl } from "@/lib/jobs/url-state";
import { fitApplication, fitUrlState } from "@/lib/jobs/for-you/pack-filters";
import type { AgentPreferences } from "@/lib/agent/preferences";
import type { ResumeData } from "@/types/resume";

/** How long the page waits for the résumé and preferences reads before it renders the client's own discovery path. */
export const ENTRY_BUDGET_MS = 400;

/** What a signed-in first frame is seeded with. `resumeOnFile: null` = not known: the client asks, as it always did. */
export interface JobsInitial {
    user: ServerUser;
    resumeOnFile: boolean | null;
    /**
     * The stored résumé as the server read it (structured data, or only the uploaded text), so the client never
     * reads it again before the first search. Text stays text: the browser structures it (`storedResumeData`),
     * résumé parsing never runs on our servers.
     */
    resume?: StoredResume;
}

export interface StoredResume {
    data?: ResumeData;
    text?: string;
    updatedAt?: string | null;
}

export type JobsEntry = { kind: "redirect"; url: string } | { kind: "render"; initial: JobsInitial | null };

/**
 * Whether the address asks for nothing: no search, job, filter or sort. Mirrors
 * the client's "at rest" (`atRest` and no active filters, sort or submit), read
 * off the parsed address so a campaign tag (`utm_*`) does not count. A résumé
 * importer link is not at rest: the redirect would drop its param.
 */
export function isBareJobsAddress(search: URLSearchParams): boolean {
    return !search.has(RESUME_IMPORTER_PARAM) && serializeJobsUrl(parseJobsUrl(search)) === "";
}

/** `/jobs` on the résumé-ranked search: the address the client's auto-fit replaces a bare /jobs with. */
export function fitEntryPath(resume: ResumeData, agentPrefs: AgentPreferences | null | undefined): string {
    const fit = fitApplication(resume, agentPrefs, { facets: {}, postedExplicit: false });
    return `/jobs${serializeJobsUrl(fitUrlState(DEFAULT_URL_STATE, fit))}`;
}

export interface JobsEntryInput {
    user: ServerUser | null;
    search: URLSearchParams;
    /** `null` when the reads missed `ENTRY_BUDGET_MS`. */
    resumeOnFile: boolean | null;
    /** The fit address, when the stored résumé is structured. `null` for none, text-only or a missed read. */
    fitPath: string | null;
    /** The stored résumé the read returned; handed on only when one is on file. */
    resume?: StoredResume | null;
}

export function resolveJobsEntry(input: JobsEntryInput): JobsEntry {
    const { user, search, resumeOnFile, fitPath, resume } = input;
    if (!user) return { kind: "render", initial: null };
    // A target that is itself bare would 307 to itself forever; render instead.
    if (resumeOnFile === true && fitPath && isBareJobsAddress(search) && !isBareJobsAddress(new URLSearchParams(fitPath.split("?")[1] ?? ""))) {
        return { kind: "redirect", url: fitPath };
    }
    return { kind: "render", initial: { user, resumeOnFile, ...(resumeOnFile === true && resume ? { resume } : {}) } };
}

const MISSED = Symbol("missed");

/** `read`'s value, or `null` when it fails or has not landed within `ms`: the caller renders the client's own path. */
export async function withinBudget<T>(read: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const value = await Promise.race([
        read.catch(() => MISSED),
        new Promise<typeof MISSED>((resolve) => {
            timer = setTimeout(() => resolve(MISSED), ms);
        }),
    ]);
    clearTimeout(timer);
    return value === MISSED ? null : (value as T);
}
