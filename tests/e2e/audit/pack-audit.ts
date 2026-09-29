/**
 * Checks one For-you recommendation against the résumé it was made for and
 * the pack tile it was shown under. Pure: the audit spec
 * (pack-recommendations.audit.ts) collects what velai.app shows and the full
 * posting behind each row, and this decides, check by check, whether the row
 * belongs there.
 *
 * Checks, each pass / fail / unknown (a side the data does not state):
 *  - place: the posting is in a country the candidate can work in (their own,
 *    one they said they'd move to), or remote with no country;
 *  - level: the posting's level is one the pack asks for;
 *  - role: the posting is the kind of role the résumé targets (`roleFit`:
 *    unknown when its title names no known role and no searched title);
 *  - pack: the posting belongs in the tile it was listed under.
 */
import { candidateCountries, resolveCandidateSignals, type CandidateSignals } from "../../../src/lib/jobs/candidate-signals";
import { packFilters } from "../../../src/lib/jobs/for-you/pack-filters";
import { hasListedSalary, isFreshJob, isRemoteJob, jobMatchesHubPack, type HubPackId } from "../../../src/lib/jobs/for-you/hub-pack-filters";
import { jobCountries } from "../../../src/lib/jobs/resume-location";
import type { PublicJob } from "../../../src/lib/jobs/types";
import { isUnknownFacetValue } from "../../../src/lib/jobs/unknown-inclusive-facets";
import { matchBand, matchBandLabel, roleFit, scoreJobAgainstResume } from "../../../src/lib/match/score";
import type { ResumeData } from "../../../src/types/resume";

export type Check = "pass" | "fail" | "unknown";

export interface AuditVerdict {
    tile: HubPackId;
    position: number;
    id: string;
    title: string;
    company: string;
    countries: string[];
    level: string;
    /** The band velai.app showed on the row. */
    shownBand: string | null;
    /** The band the current scorer gives this résumé and posting, scored as the
     *  list row is (list payloads carry no description), so it compares with `shownBand`. */
    band: string | null;
    why: string;
    checks: { place: Check; level: Check; role: Check; pack: Check };
}

function placeCheck(signals: CandidateSignals, job: PublicJob): Check {
    const jobList = jobCountries(job);
    const own = candidateCountries(signals);
    if (isRemoteJob(job) && jobList.length === 0) return "pass";
    if (own.length === 0 || jobList.length === 0) return "unknown";
    if (own.some((country) => jobList.includes(country))) return "pass";
    const relocation = signals.relocation.value;
    if (relocation?.open && (relocation.countries.length === 0 || relocation.countries.some((c) => jobList.includes(c)))) return "pass";
    return "fail";
}

function levelCheck(wanted: string[] | undefined, job: PublicJob): Check {
    if (!wanted?.length) return "pass";
    if (isUnknownFacetValue("experience_level", job.experience_level)) return "unknown";
    return wanted.includes(job.experience_level ?? "") ? "pass" : "fail";
}

function packCheck(tile: HubPackId, job: PublicJob, nowMs: number): Check {
    switch (tile) {
        case "all":
            return "pass";
        case "remote":
            return isRemoteJob(job) ? "pass" : "fail";
        case "fresh":
            return job.posted_at || job.posted_ts ? (isFreshJob(job, nowMs) ? "pass" : "fail") : "unknown";
        case "salary":
            return hasListedSalary(job) ? "pass" : "fail";
        default:
            return jobMatchesHubPack(job, tile, nowMs) ? "pass" : "fail";
    }
}

const ROLE_CHECK = { target: "pass", unverified: "unknown", "off-target": "fail" } as const satisfies Record<string, Check>;

export function auditRecommendation(input: {
    resume: ResumeData;
    tile: HubPackId;
    position: number;
    job: PublicJob;
    shownBand: string | null;
    nowMs: number;
}): AuditVerdict {
    const { resume, tile, position, job, shownBand, nowMs } = input;
    const signals = resolveCandidateSignals(resume, null);
    const pack = packFilters(resume, signals);
    const score = scoreJobAgainstResume(resume, { ...job, description: null }, signals);
    const relevance = score?.components.find((c) => c.key === "relevance");
    return {
        tile,
        position,
        id: job.id,
        title: job.title ?? "",
        company: job.company ?? "",
        countries: jobCountries(job),
        level: job.experience_level ?? "unknown",
        shownBand,
        band: score ? matchBandLabel(matchBand(score.total)) : null,
        why: relevance?.detail ?? "no terms in common",
        checks: {
            place: placeCheck(signals, job),
            level: levelCheck(pack.facets.experience_level, job),
            role: ROLE_CHECK[roleFit(resume, job)],
            pack: packCheck(tile, job, nowMs),
        },
    };
}

export const failedChecks = (v: AuditVerdict): string[] =>
    Object.entries(v.checks)
        .filter(([, check]) => check === "fail")
        .map(([name]) => name);

const MARK: Record<Check, string> = { pass: "✓", fail: "✗", unknown: "?" };
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** One Markdown section per résumé: a row per recommendation, then what failed. */
export function renderAuditMarkdown(resumes: { name: string; searched: string[]; verdicts: AuditVerdict[]; empty: HubPackId[] }[]): string {
    const out: string[] = ["# For-you pack audit", ""];
    for (const { name, searched, verdicts, empty } of resumes) {
        const failed = verdicts.filter((v) => failedChecks(v).length > 0);
        out.push(`## ${name}`, "", `Searches: ${searched.join(", ")}`, "");
        out.push(`${verdicts.length} recommendations checked, ${failed.length} with a failed check.`);
        if (empty.length) out.push(`Tiles with no roles: ${empty.join(", ")}.`);
        out.push("", "| Tile | # | Role | Company | Country | Level | Shown | Now | Place | Level | Role | Pack | Why |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
        for (const v of verdicts) {
            out.push(
                `| ${v.tile} | ${v.position} | ${cell(v.title)} | ${cell(v.company)} | ${cell(v.countries.join(", ") || "?")} | ${v.level} | ${v.shownBand ?? "-"} | ${v.band ?? "-"} | ${MARK[v.checks.place]} | ${MARK[v.checks.level]} | ${MARK[v.checks.role]} | ${MARK[v.checks.pack]} | ${cell(v.why)} |`,
            );
        }
        out.push("");
    }
    return out.join("\n");
}
