/**
 * Résumé ↔ job match score — "The Match Receipt".
 *
 * Arithmetic, not oracle: every number here comes from comparing the ONE
 * upload parse (already produced once, at upload, entirely on-device by
 * `parseResumeLocally` — see lib/local-ai/parse-resume.ts) against a job's
 * own fields. No LLM call lives in this module or is reachable from it.
 * This is also the single scoring
 * function — the SERP card chip, the job-detail header chip, and `sort=fit`'s
 * client-side reorder all call `scoreJobAgainstResume` directly, so they can
 * never disagree about a score.
 *
 * Pure TS, no server/client imports (mirrors resume-match.ts's isomorphic
 * convention) — this runs client-side on `/jobs` and can run server-side on
 * `/co` without change.
 *
 * Honest gaps: `relevance` is required — a pair with no topical overlap
 * returns `null` (no chip), never a fabricated 0. Seniority and location are
 * always reported; a side that is unknown makes that component neutral and
 * flagged `unknown` (see `scoreJobAgainstResume`).
 *
 * Redesign (2026-08): the previous version scored `skills` and `occupation`
 * as two independent, individually-optional components, then renormalized
 * the weighted total over whichever components actually had data. That let
 * a job/résumé pair with NO topical overlap at all — skills didn't share a
 * tag, no occupation on either side — still land at 100 purely because
 * `seniority` happened to match; renormalizing "found nothing on the
 * subject, but the level matches" up to a full score is not an honest
 * receipt. `scoreSkills` had a second, independent bug: it divided by the
 * RÉSUMÉ's own full skill count, so a candidate with a long, real skill list
 * that only PARTIALLY overlaps a job's own (short) ask got crushed toward
 * zero by their own thoroughness — the fraction shrinks as the résumé lists
 * more skills, regardless of how well those skills cover what the job
 * actually wants.
 *
 * `relevance` replaces both `skills` and `occupation` with one token-overlap
 * component whose denominator is the JOB's own vocabulary (title + tags, rank
 * words stripped), not the résumé's. The résumé side compares skills, profession, role titles, and
 * responsibility text (experience/project bullets + summary + skills, via
 * resumeDutyTokens). That fixes both bugs
 * at once: coverage is always "how much of what this role asks for is in
 * your résumé" — a longer résumé can only help (more terms to match against
 * the same fixed job vocabulary) — and it's now REQUIRED, so a pair with no
 * topical overlap returns `null` (no chip) rather than falling back to a
 * seniority-only 100. `seniority` stays as an optional modifier on top.
 */
import {
    candidateCountries,
    resolveCandidateSignals,
    seniorityOfLevel,
    type CandidateSignals,
    preferredRoles,
} from "@/lib/jobs/candidate-signals";
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { payPlace } from "@/lib/jobs/pay-place";
import { resumeManagedPeople, titleLevel, titleManagesPeople, yearsAsked } from "@/lib/jobs/role-level";
import { jobCountries, titlePlace } from "@/lib/jobs/resume-location";
import { isUnknownFacetValue } from "@/lib/jobs/unknown-inclusive-facets";
import { jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { conceptCoverage, jdCoverage, jdFitScore, jdTermsOf, resumeTermSet } from "@/lib/match/jd-match";
import { buildMatchQuery, ledLongCareer, seniorityFromYears, targetRoles, topSkills, type Seniority } from "@/lib/jobs/resume-match";
import { familiesNamedBy, RANK_WORDS, resumeDutyTokens, type RoleFamilyId } from "@/lib/match/duty-signals";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type MatchComponentKey = "relevance" | "seniority" | "location";

export interface MatchComponent {
    key: MatchComponentKey;
    label: string;
    /** Honest, computed verdict text — e.g. "7 of 12 terms this role names", "senior role — matches your senior level (set in Settings)". */
    detail: string;
    /** This component's own match quality, 0..1. */
    score: number;
    /** True when a side of the comparison is unknown: `score` is the neutral
     *  `UNKNOWN_COMPONENT_SCORE`, not evidence of a fit or a misfit. */
    unknown?: boolean;
    /** Which verdict `detail` states, for surfaces that word it themselves (match/explain.ts). */
    reason?: MatchReason;
    /** Relevance only: how many of the posting's terms the résumé has, of how many. */
    terms?: { matched: number; of: number };
    /**
     * Relevance only, when the posting's description was read (`jd-match.ts`):
     * how much of what it asks for the résumé shows (0..1 after calibration),
     * and the posting's own terms the résumé has / lacks, requirements first.
     */
    jd?: { fit: number; matched: string[]; missing: string[] };
    /** Location only, for a role outside the candidate's countries: where it is, and the pay's currency when only the pay says so. */
    place?: { where: string; currency?: string };
    /** Seniority only, when both levels are known: what each was read from, for the reason a role shows (match/explain.ts). */
    level?: SeniorityRead;
}

/**
 * The two levels a seniority verdict compares and where each came from: the
 * role's from its listing, its title or the years it asks for (`jobLevelRead`),
 * the candidate's from Settings or from their résumé (`resumeSeniorityBasis`):
 * their years, with the role they hold now when only those years counted, or
 * the title they hold now when it names a higher level.
 */
export interface SeniorityRead {
    own: Seniority;
    job: Seniority;
    jobFrom: JobLevelRead["from"];
    /** The years the role asks for, when they set its level. */
    jobYears?: number;
    /** The role's title runs a team ("Manager, Customer Success"), when that set its level. */
    jobRunsTeam?: true;
    ownFrom: "settings" | "resume";
    years?: number;
    role?: string | null;
    /** The title the candidate holds now, when it set their level. */
    title?: string;
}

/** The verdict behind a seniority or location component's `detail`. */
export type MatchReason =
    | "level_fits"
    | "level_above_ask"
    | "level_below_ask"
    | "level_unlisted"
    | "no_years"
    | "remote_anywhere"
    | "remote_unplaced"
    | "remote_pay_home"
    | "remote_preferred"
    | "no_resume_place"
    | "resume_place_unmatched"
    | "country_unlisted"
    | "same_country"
    | "remote_same_country"
    | "relocation_country"
    | "remote_abroad"
    | "remote_pay_abroad"
    | "abroad";

export interface MatchScore {
    /** 0-100 integer. */
    total: number;
    components: MatchComponent[];
    /** How the posting's title relates to the roles the résumé names (`roleAffinity`). */
    role?: RoleAffinity;
    /** The candidate's own role as the résumé names it: the one the posting matched, else their main one. */
    yourRole?: string | null;
    /** Which of the résumé's role families the title belongs to, strongest first (`familyRank`). */
    familyRank?: number;
    /** Set when the role is outside every country the candidate can work in (`MatchOutside`). */
    outside?: MatchOutside;
    /**
     * Its title is a people manager's (`titleManagesPeople`) and no role or line on the résumé shows
     * its owner managing people (`resumeManagedPeople`). Such a role is a Stretch whatever their level.
     */
    newToManaging?: true;
    /**
     * One level above a mid-level read from a new line of work, for a long career that already led
     * people or work (`ledLongCareer`): a reach, Good at best, not a Stretch.
     */
    reach?: true;
}

/**
 * A role outside every country the candidate can work in: theirs, or one they
 * said they'd move to (`OUTSIDE_REASONS`). Its label names that
 * (`matchLabel`: "Outside Canada") instead of a fit word, on every surface,
 * and its total sits under Good, so lists rank it after the roles they can
 * take, counts never call it a fit and Today leaves it out.
 */
export interface MatchOutside {
    /** The candidate's countries. */
    home: string[];
    /** Where the role is, as named: "United States", "Europe". */
    where: string;
    /** The pay's currency, when only the pay says where (`remote_pay_abroad`). */
    currency?: string;
    /** Where the candidate's country was read: their Settings, or their résumé. */
    from: "settings" | "resume";
    /** The total before the cap under Good, for a reader that checks whether the place still holds (Today's `placeCheckIds`). */
    total: number;
}

/**
 * Component weights. The ONLY place these live. The total is the weighted sum
 * over ALL components divided by the fixed sum of the weights: a component
 * that cannot be compared (unknown candidate or job side) counts as the
 * neutral `UNKNOWN_COMPONENT_SCORE` and says so — it is never dropped from
 * the average, which would let the components that remain stand in for it.
 * `relevance` is REQUIRED (the whole match is `null` without it).
 */
export const MATCH_WEIGHTS: Readonly<Record<MatchComponentKey, number>> = {
    relevance: 0.75,
    seniority: 0.25,
    location: 0.10,
};

const WEIGHT_SUM = Object.values(MATCH_WEIGHTS).reduce((sum, w) => sum + w, 0);

/** What a component scores when one side of its comparison is unknown. */
export const UNKNOWN_COMPONENT_SCORE = 0.5;

/** Qualitative fit bands on the 0–100 integer `MatchScore.total` scale. */
export type MatchBand = "stretch" | "good" | "strong";

/** Lower bound (inclusive) for Good — Stretch is strictly below this. */
export const MATCH_BAND_GOOD_MIN = 60;
/** Lower bound (inclusive) for Strong — Good is 60–79 inclusive. */
export const MATCH_BAND_STRONG_MIN = 80;

/** Chip renders with a brand-color outline for Strong (≥80); below it, the default muted border. */
export const MATCH_CHIP_BRAND_THRESHOLD = MATCH_BAND_STRONG_MIN;

/** Maps a 0–100 match total to Stretch / Good / Strong. */
export function matchBand(score: number): MatchBand {
    if (!Number.isFinite(score)) return "stretch";
    if (score >= MATCH_BAND_STRONG_MIN) return "strong";
    if (score >= MATCH_BAND_GOOD_MIN) return "good";
    return "stretch";
}

export function matchBandLabel(band: MatchBand): "Stretch" | "Good" | "Strong" {
    if (band === "strong") return "Strong";
    if (band === "good") return "Good";
    return "Stretch";
}

/** Location verdicts that put a role outside every country the candidate can work in. */
export const OUTSIDE_REASONS: ReadonlySet<MatchReason> = new Set(["abroad", "remote_abroad", "remote_pay_abroad"]);

/** Location verdicts for a role that doesn't say which countries it hires in, read against a candidate whose country is known. */
export const UNPLACED_REASONS: ReadonlySet<MatchReason> = new Set(["remote_unplaced", "country_unlisted"]);

/** The label of a role that doesn't say which countries it hires in (`placeUnclear`). */
export const PLACE_UNCLEAR_LABEL = "Country unclear";

/**
 * The role doesn't say which countries it hires in, so there's no telling
 * whether the candidate can take it: its label says that instead of a fit
 * word. "Good · Remote" on a role that turned out to be US-only read as a
 * recommendation (2026-10-05). A candidate whose own country is unknown is a
 * different case: every role is unknown to them, and Today asks where they
 * can work instead.
 */
export function placeUnclear(score: MatchScore): boolean {
    return !score.outside && score.components.some((c) => c.key === "location" && c.reason != null && UNPLACED_REASONS.has(c.reason));
}

/** The label names where the role is (`outside`) or that it doesn't say (`placeUnclear`), not how well it fits. */
export function labelNamesPlace(score: MatchScore): boolean {
    return score.outside != null || placeUnclear(score);
}

/** Country names a chip shortens. */
const SHORT_COUNTRY: Readonly<Record<string, string>> = {
    "United States": "US",
    "United Kingdom": "UK",
    "United Arab Emirates": "UAE",
};

/** Longer country names, and more than one country, read "Abroad" so the label fits where a fit word does. */
const OUTSIDE_LABEL_MAX_NAME = 14;

/** "Outside Canada", "Outside US"; "Abroad" for a candidate with several countries or a long name. */
export function outsideLabel(home: readonly string[]): string {
    const name = home.length === 1 ? (SHORT_COUNTRY[home[0]!] ?? home[0]!) : null;
    return name && name.length <= OUTSIDE_LABEL_MAX_NAME ? `Outside ${name}` : "Abroad";
}

/**
 * The label a role shows the candidate, the same on every surface: Strong,
 * Good or Stretch for how well it fits, where it is when it's outside every
 * country they can work in, or "Country unclear" when it doesn't say where it
 * hires. A fit word on a role they can't take read as a fit: Island's
 * "Technical Account Manager - U.S. Federal" said Good to a résumé in Toronto
 * (2026-10-03).
 */
export function matchLabel(score: MatchScore): string {
    if (score.outside) return outsideLabel(score.outside.home);
    return placeUnclear(score) ? PLACE_UNCLEAR_LABEL : matchBandLabel(matchBand(score.total));
}

/**
 * `PublicJob.experience_level`'s real vocabulary, in ladder order — also the
 * candidate's (`Seniority`, resume-match.ts). A job value not in this list,
 * including "unknown", has no index, so the comparison is unknown rather
 * than guessed. Matched on the VALUE itself (indexOf), not by enumerating
 * "unknown" as a special case.
 */
const EXPERIENCE_LEVEL_ORDER: readonly Seniority[] = ["entry", "mid", "senior"];

function normalize(s: string): string {
    return s.trim().toLowerCase();
}

/** `meaningfulTitleTokens` (stop-words stripped) with rank words ALSO stripped — the shared step both vocabularies below run through. */
function relevanceTokens(s: string): string[] {
    return meaningfulTitleTokens(s).filter((t) => !RANK_WORDS.has(t));
}

/** Simple singular/plural tolerance carried over from the pre-redesign skills
 *  comparison (no fuzzy/embedding matching) — a job token matches a résumé
 *  vocabulary that has it verbatim OR off by exactly one trailing "s". */
function vocabHasToken(vocab: ReadonlySet<string>, token: string): boolean {
    return vocab.has(token) || vocab.has(`${token}s`) || (token.endsWith("s") && vocab.has(token.slice(0, -1)));
}

/**
 * A job's own topical vocabulary: title + tags. Only fields every list row
 * carries (`JOB_LIST_ATTRIBUTES_TO_RETRIEVE`), so a role scores the same in a
 * list, on Today and on its own page. The page used to add `occupation` and the
 * description's opening words, which list rows don't have: Expel's "Technical
 * Account Manager" was Strong on Today (3 of 3 title terms) and Stretch on its
 * page (8 of 29 once the description's first sentences counted).
 */
function jobVocabulary(job: PublicJob): Set<string> {
    return new Set([...relevanceTokens(job.title ?? ""), ...(job.tags ?? []).flatMap((tag) => relevanceTokens(tag))]);
}

/**
 * A résumé's topical vocabulary: skills, profession, role titles, and
 * responsibility tokens from resumeDutyTokens (summary + experience/project
 * bullets + skills — see resumeMatchText). `topSkills(resume, Infinity)`
 * (not the default cap of 8) so a long, real skill list is never truncated
 * out of contention.
 */
function resumeVocabulary(resume: ResumeData): Set<string> {
    const tokens = [
        ...topSkills(resume, Number.POSITIVE_INFINITY).flatMap((skill) => relevanceTokens(skill)),
        ...relevanceTokens(resume.profile?.profession ?? ""),
        ...(resume.experience ?? []).flatMap((exp) => relevanceTokens(exp.role ?? "")),
        ...resumeDutyTokens(resume),
    ];
    return new Set(tokens);
}

/**
 * REQUIRED component (see module doc for why): how much of the job's own
 * vocabulary shows up in the résumé's. `score = min(1, coverage / 0.6)` — a
 * candidate covering 60%+ of a role's own terms already reads as a strong
 * match; the curve doesn't demand near-total overlap (job vocabulary
 * includes incidental terms — a stray tag, a boilerplate word in the title —
 * that no real candidate's résumé would ever fully enumerate).
 */
const RELEVANCE_COVERAGE_FLOOR = 0.6;

/**
 * How much the title says vs. what the whole posting says, when its
 * description has been read. Half and half: the title is still the clearest
 * statement of what the job IS, the description is the only statement of
 * what it ASKS (review, 2026-10-13 — see jd-match.ts for why title-only
 * relevance could not tell one "Product Manager" posting from another).
 */
export const JD_RELEVANCE_SHARE = 0.75;

/** Concept coverage reads a little under word coverage at the same share: kinds of work are broader than words. */
export const CONCEPT_FIT_SCALE = 0.9;

/**
 * Below this share of what the posting asks showing on the résumé, a role is
 * never Good: Salesforce's "Customer Success Manager - Global Public Sector"
 * read Good at 35% (Vivek, 2026-10-13). The title alone can't make a fit.
 */
export const JD_GOOD_MIN_FIT = 0.5;

function scoreRelevance(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const jobVocab = jobVocabulary(job);
    const resumeVocab = resumeVocabulary(resume);
    if (jobVocab.size === 0 || resumeVocab.size === 0) return null;

    const matched = [...jobVocab].filter((token) => vocabHasToken(resumeVocab, token));
    const coverage = matched.length / jobVocab.size;
    const titleScore = Math.min(1, coverage / RELEVANCE_COVERAGE_FLOOR);
    const titleDetail = `${matched.length} of ${jobVocab.size} terms this role names`;

    // The whole posting, when its description (or the terms read from it) is on hand.
    const terms = jdTermsOf(job);
    const jd = terms ? jdCoverage(resume, terms) : null;
    if (!jd) {
        return { key: "relevance", label: "Relevance to this role", detail: titleDetail, score: titleScore, terms: { matched: matched.length, of: jobVocab.size } };
    }
    // The posting's words, or the kinds of work it asks for, whichever the résumé shows more of:
    // a PM résumé that says "backlog grooming" covers a posting's "prioritize the roadmap".
    const concepts = conceptCoverage(resume, terms!);
    const fit = Math.max(jdFitScore(jd.coverage, resumeTermSet(resume).size), concepts ? concepts.share * CONCEPT_FIT_SCALE : 0);
    const shown = jd.matched.slice(0, 4);
    return {
        key: "relevance",
        label: "Relevance to this role",
        detail: `${titleDetail} · ${Math.round(fit * 100)}% of what it asks shows on your résumé${shown.length > 0 ? ` (${shown.join(", ")})` : ""}`,
        score: (1 - JD_RELEVANCE_SHARE) * titleScore + JD_RELEVANCE_SHARE * fit,
        terms: { matched: matched.length, of: jobVocab.size },
        jd: { fit, matched: jd.matched.slice(0, 12), missing: jd.missing.slice(0, 12) },
    };
}

/**
 * Pure: the terms behind the relevance row ("2 of 3 terms this role names"),
 * split into the ones the résumé has and the ones it doesn't, in the job's
 * order. Same vocabularies and matching as `scoreRelevance`, so the lists
 * always add up to the row's counts.
 */
export function relevanceTerms(resume: ResumeData, job: PublicJob): { matched: string[]; missing: string[] } {
    const resumeVocab = resumeVocabulary(resume);
    const matched: string[] = [];
    const missing: string[] = [];
    for (const token of jobVocabulary(job)) (vocabHasToken(resumeVocab, token) ? matched : missing).push(token);
    return { matched, missing };
}

/** A `relevanceTerms` term ("icu") as the job writes it in its title or tags ("ICU"). */
export function termAsWritten(term: string, job: PublicJob): string {
    const words = [job.title, ...(job.tags ?? [])].join(" ").split(/[^\p{L}\p{N}+#.]+/u);
    return words.find((word) => word.toLowerCase() === term) ?? term;
}

function isRemoteWorkType(workType: string | null | undefined): boolean {
    return /remote/i.test(workType ?? "");
}

const locationComponent = (
    reason: MatchReason,
    detail: string,
    score: number,
    unknown?: boolean,
    place?: MatchComponent["place"],
): MatchComponent => ({
    key: "location",
    label: "Location",
    detail,
    score,
    reason,
    ...(unknown ? { unknown } : {}),
    ...(place ? { place } : {}),
});

/**
 * Candidate location vs job location. One rule, for every country and role: a
 * role is open to the candidate only on positive evidence, and anything else
 * is either outside where they can work or unknown, never assumed open.
 *
 * Where the role is: its tags or place text, narrowed by the territory its
 * title names ("TAM - U.S. Federal" tagged United States and Canada is a US
 * role) and then by what its description requires ("must reside in the
 * US"). A narrower reading that shares no country with the wider one leaves
 * the wider one as it is.
 *
 * Open (a fit word): their country, or one they said they'd move to (0.8), is
 * among the role's; a remote role says it is open anywhere; or a remote role
 * that names no country pays in their own country's money. Outside (capped
 * under Good, labelled "Outside Canada"): the role's countries are known and
 * none is theirs (0.35, 0.65 remote), or a remote role that names no country
 * pays in another country's money (`remote_pay_abroad`). Unknown (neutral,
 * flagged, never Strong, never a Today pick): their country can't be read,
 * or the role says nowhere where it hires (`remote_unplaced`,
 * `country_unlisted`). Remote with no country used to count as open to
 * anyone, so US-only roles posted as "Remote" read as fits in Canada.
 *
 * A remote-only preference says how they want to work, not where they can:
 * a remote role tied to another country is still `remote_abroad`.
 */
function scoreLocation(signals: CandidateSignals, job: PublicJob): MatchComponent {
    const remote = isRemoteWorkType(job.work_type);
    let jobList = jobCountries(job);
    let jobPlace: string | null = null;
    for (const named of [titlePlace(job.title), job.place_restriction ?? null]) {
        if (!named || named.countries.length === 0) continue;
        if (jobList.length === 0) {
            jobList = named.countries;
            jobPlace = named.label;
            continue;
        }
        const narrowed = jobList.filter((country) => named.countries.includes(country));
        if (narrowed.length > 0 && narrowed.length < jobList.length) {
            jobList = narrowed;
            jobPlace = named.label;
        }
    }
    const wantsRemote = Boolean(signals.remotePreference.value) && remote;
    if (remote && jobList.length === 0 && opensAnywhere(job)) {
        return wantsRemote
            ? locationComponent("remote_preferred", "remote — matches your remote-only preference", 1)
            : locationComponent("remote_anywhere", "remote — open to people anywhere", 1);
    }

    const own = candidateCountries(signals);
    if (own.length === 0) {
        return locationComponent(
            signals.location.value ? "resume_place_unmatched" : "no_resume_place",
            signals.location.value ? "your résumé's place names no country we can match" : "no location on your résumé",
            UNKNOWN_COMPONENT_SCORE,
            true,
        );
    }
    if (jobList.length === 0) {
        if (!remote) return locationComponent("country_unlisted", "this role's country isn't listed", UNKNOWN_COMPONENT_SCORE, true);
        // A currency alone can be a default, not a posted range: only a stated amount counts.
        const pay = job.salary_min == null && job.salary_max == null ? null : payPlace(job.salary_currency);
        if (!pay) return locationComponent("remote_unplaced", "remote — doesn't say which countries it hires in", UNKNOWN_COMPONENT_SCORE, true);
        if (own.some((country) => pay.countries.includes(country))) {
            return locationComponent("remote_pay_home", `remote with no country listed, paid in ${pay.currency} — your country's money`, 1);
        }
        if (relocatesTo(signals, pay.countries)) return locationComponent("relocation_country", "in a country you said you'd relocate to", 0.8);
        return locationComponent(
            "remote_pay_abroad",
            `remote with no country listed, paid in ${pay.currency} — likely for people in ${pay.label}`,
            0.65,
            false,
            { where: pay.label, currency: pay.currency },
        );
    }
    if (own.some((country) => jobList.includes(country))) {
        if (wantsRemote) return locationComponent("remote_preferred", "remote — matches your remote-only preference", 1);
        return remote
            ? locationComponent("remote_same_country", "remote — same country", 1)
            : locationComponent("same_country", "same country", 1);
    }
    if (relocatesTo(signals, jobList)) return locationComponent("relocation_country", "in a country you said you'd relocate to", 0.8);
    const where = jobPlace ?? jobList.join(", ");
    return remote
        ? locationComponent("remote_abroad", `remote — based in ${where}`, 0.65, false, { where })
        : locationComponent("abroad", `different country — ${where}`, 0.35, false, { where });
}

/** Place text that opens a role to everyone: "Remote - Anywhere", "Worldwide", "Global". */
const ANYWHERE_PLACE = /\b(?:anywhere|worldwide|world-wide|global|globally|any location|all locations|international)\b/i;

/** A role that says it hires anywhere: in its description (`place_restriction` with no countries) or its place text. */
function opensAnywhere(job: PublicJob): boolean {
    if (job.place_restriction && job.place_restriction.countries.length === 0) return true;
    return [job.location, job.location_city, job.location_state].some((text) => ANYWHERE_PLACE.test(text ?? ""));
}

/** They said they'd move to one of `countries`, or anywhere. */
function relocatesTo(signals: CandidateSignals, countries: readonly string[]): boolean {
    const relocation = signals.relocation.value;
    return Boolean(relocation?.open && (relocation.countries.length === 0 || relocation.countries.some((c) => countries.includes(c))));
}

const SENIORITY_LABEL: Record<Seniority, string> = { entry: "entry-level", mid: "mid-level", senior: "senior" };

/** A role's level and what said it: its listing, its title (`titleLevel`), or the years it asks for. */
export interface JobLevelRead {
    level: Seniority;
    from: "listing" | "title" | "years";
    /** The years asked, when they set the level. */
    years?: number;
    /** The title runs a team ("Manager, Customer Success"), when it set the level. */
    runsTeam?: true;
}

/**
 * A role's level: the highest of what its listing names, what its title names
 * (a rank word, or a title that runs a team) and what the years it asks for
 * read as on the same scale as the candidate's years (`seniorityFromYears`).
 * Whatever the posting says it asks for is what it asks for: a "Senior
 * Technical Account Manager" whose level was never listed read as unknown,
 * so it was a pick for a mid-level TAM (2026-10-06), and Sophos's "Manager,
 * Customer Success (Enterprise)", asking for 7+ years and 5+ managing a team,
 * read as a TAM's own level (2026-10-11).
 */
export function jobLevel(job: Pick<PublicJob, "experience_level" | "title" | "min_years_experience">): Seniority | null {
    return jobLevelRead(job)?.level ?? null;
}

/** `jobLevel`, with what said it. A listed Lead or Executive reads senior, Intern entry. On a tie the listing, then the title, is named. */
export function jobLevelRead(job: Pick<PublicJob, "experience_level" | "title" | "min_years_experience">): JobLevelRead | null {
    const reads: JobLevelRead[] = [];
    const listed = seniorityOfLevel(job.experience_level);
    if (listed) reads.push({ level: listed, from: "listing" });
    const titled = titleLevel(job.title);
    if (titled) reads.push({ level: titled.level, from: "title", ...(titled.runsTeam ? { runsTeam: true as const } : {}) });
    const years = yearsAsked(job.min_years_experience);
    const byYears = years == null ? null : seniorityFromYears(years);
    if (byYears) reads.push({ level: byYears, from: "years", years: years! });
    return reads.reduce<JobLevelRead | null>(
        (top, read) => (!top || EXPERIENCE_LEVEL_ORDER.indexOf(read.level) > EXPERIENCE_LEVEL_ORDER.indexOf(top.level) ? read : top),
        null,
    );
}

/**
 * The role's level in the words its details show: the listing's own word ("lead role"), the title's
 * ("senior role by its title", "senior role: its title runs a team") or the years ("senior role by the 7+ years it asks for").
 */
function roleLevelText(job: Pick<PublicJob, "experience_level">, read: JobLevelRead): string {
    if (read.from === "title") return read.runsTeam ? `${SENIORITY_LABEL[read.level]} role: its title runs a team` : `${SENIORITY_LABEL[read.level]} role by its title`;
    if (read.from === "years") return `${SENIORITY_LABEL[read.level]} role by the ${read.years}+ years it asks for`;
    const listed = normalize(job.experience_level ?? "");
    return `${(SENIORITY_LABEL as Record<string, string>)[listed] ?? listed} role`;
}

/** The candidate's level with what it was read from: "your mid level (5 years as a Technical Account Manager)". */
function ownLevelText(read: SeniorityRead): string {
    const level = `your ${read.own} level`;
    if (read.ownFrom === "settings") return `${level} (set in Settings)`;
    if (read.title) return `${level} (your title, ${read.title})`;
    if (read.years == null) return level;
    const years = `${read.years} ${read.years === 1 ? "year" : "years"}`;
    if (!read.role) return `${level} (${years} of experience)`;
    return `${level} (${years} as ${/^[aeiou]/i.test(read.role) ? "an" : "a"} ${read.role})`;
}

/**
 * Candidate seniority vs the role's level (`jobLevel`). Unknown on either side is neutral and flagged.
 * The detail names the role's level first, as its details show it, then the candidate's with its
 * source: "senior — exceeds ask" read as the role's level beside a listing marked Mid (2026-10-09).
 */
function scoreSeniority(signals: CandidateSignals, job: PublicJob): MatchComponent {
    const own = signals.seniority.value;
    const read = jobLevelRead(job);
    const jobIndex = read ? EXPERIENCE_LEVEL_ORDER.indexOf(read.level) : -1;
    const unknown = (reason: MatchReason, detail: string): MatchComponent => ({
        key: "seniority",
        label: "Seniority",
        detail,
        score: UNKNOWN_COMPONENT_SCORE,
        unknown: true,
        reason,
    });
    if (!own) return unknown("no_years", "no years of experience on your résumé");
    if (jobIndex === -1) return unknown("level_unlisted", "this role's level isn't listed");

    const diff = EXPERIENCE_LEVEL_ORDER.indexOf(own) - jobIndex;
    const score = diff === 0 ? 1 : diff > 0 ? 0.65 : 0.25;
    const verdict = diff === 0 ? "matches" : diff > 0 ? "below" : "above";
    const reason: MatchReason = diff === 0 ? "level_fits" : diff > 0 ? "level_above_ask" : "level_below_ask";
    const basis = signals.seniority.basis;
    const level: SeniorityRead = {
        own,
        job: read!.level,
        jobFrom: read!.from,
        ...(read!.years != null ? { jobYears: read!.years } : {}),
        ...(read!.runsTeam ? { jobRunsTeam: true as const } : {}),
        ownFrom: signals.seniority.source === "explicit" ? "settings" : "resume",
        ...(basis && signals.seniority.source !== "explicit"
            ? { years: basis.years, role: basis.role, ...(basis.title ? { title: basis.title } : {}) }
            : {}),
    };
    return { key: "seniority", label: "Seniority", detail: `${roleLevelText(job, read!)} — ${verdict} ${ownLevelText(level)}`, score, reason, level };
}

/**
 * What a people manager's role for a résumé that shows no one managed (`MatchScore.newToManaging`) says,
 * on the seniority receipt and in the reason. When the level already reads "its title runs a team", only
 * the résumé's side is left to say.
 */
export function newToManagingText(read: SeniorityRead | undefined): string {
    return read?.jobRunsTeam
        ? "no role on your résumé shows you managing people"
        : "its title manages people, which no role on your résumé shows you doing";
}

/**
 * A seniority filter also retrieves jobs whose level was never derived
 * (`unknown-inclusive-facets.ts`). For a candidate whose level IS known, such a
 * job cannot be verified as a fit, so like an unverifiable location it never
 * reads as Strong — the ranker then places the verified-level jobs above it.
 */
export function levelUnverified(signals: CandidateSignals, job: PublicJob): boolean {
    return signals.seniority.value != null && isUnknownFacetValue("experience_level", job.experience_level);
}

interface ResumeTargets {
    families: RoleFamilyId[];
    searched: string[];
    own: string[];
    ownFamilies: RoleFamilyId[];
    /** `ownFamilies` in the whole résumé's order of strength (`families`): which of its own roles leads. */
    leading: RoleFamilyId[];
    /** A role or line on the résumé shows its owner managing people (`resumeManagedPeople`). */
    managed: boolean;
}

/** Per résumé object and stated roles: the role families it targets, the titles its packs search for, its own role, and whether it shows managing people. */
const TARGETS = new WeakMap<ResumeData, Map<string, ResumeTargets>>();

function resumeTargets(resume: ResumeData, preferred: readonly string[] = []): ResumeTargets {
    const key = preferred.join("\u0000").toLowerCase();
    let byRoles = TARGETS.get(resume);
    if (!byRoles) TARGETS.set(resume, (byRoles = new Map()));
    let targets = byRoles.get(key);
    if (!targets) {
        const roles = targetRoles(resume, preferred);
        targets = {
            families: roles.families,
            searched: buildMatchQuery(resume, undefined, preferred).phrases,
            own: roles.own,
            ownFamilies: roles.ownFamilies,
            leading: [
                ...roles.families.filter((family) => roles.ownFamilies.includes(family)),
                ...roles.ownFamilies.filter((family) => !roles.families.includes(family)),
            ],
            managed: resumeManagedPeople(resume),
        };
        byRoles.set(key, targets);
    }
    return targets;
}

/**
 * How a posting's title relates to the roles the résumé targets:
 *  - `target`: the title contains a title the pack searched for, or names a
 *    role family the résumé targets;
 *  - `off-target`: the title names only role families the résumé does not
 *    target (a Backend Engineer posting for a product manager);
 *  - `unverified`: the title names no known family ("Health and Safety
 *    Manager"), or the résumé's own target could not be read.
 * List rows are scored on title and tags alone (list payloads carry no
 * description), so a title sharing two words with a résumé ("health",
 * "manager" for a PM at a health company) could read Strong on those words.
 */
export type RoleFit = "target" | "unverified" | "off-target";

export function roleFit(resume: ResumeData, job: PublicJob, preferred: readonly string[] = []): RoleFit {
    const { families, searched } = resumeTargets(resume, preferred);
    const title = job.title ?? "";
    // Whole words, in order (`jobTitleMatchesTarget`): a substring test read
    // "Nursery Teacher" as a "Nurse" posting.
    if (searched.some((phrase) => jobTitleMatchesTarget(title, phrase))) return "target";
    const jobFamilies = familiesNamedBy([job.title ?? ""]);
    if (jobFamilies.length === 0 || families.length === 0) return "unverified";
    return jobFamilies.some((family) => families.includes(family)) ? "target" : "off-target";
}

/**
 * How close a posting's title is to the candidate's own role, closest first:
 *  - `own`: the title is a role the candidate calls themselves (their headline,
 *    current role, or the title their summary opens with — `targetRoles().own`),
 *    whatever the rank words: "Sr. Technical Account Manager, Enterprise" for a TAM;
 *  - `family`: the title names the same kind of role as theirs (a Backend
 *    Engineer posting for a software engineer);
 *  - `adjacent`: a role the pack also searched for but a different kind of job
 *    (a Product Manager posting for a TAM);
 *  - `unverified` / `off-target`: as `roleFit`.
 *
 * Ranked lists put the candidate's own role first (`roleTier`). Before this,
 * every searched title counted the same, so a TAM's list was led by senior
 * Product Manager postings that tied on title words and won on level.
 */
export type RoleAffinity = "own" | "family" | "adjacent" | "unverified" | "off-target";

export function roleAffinity(resume: ResumeData, job: PublicJob, preferred: readonly string[] = []): RoleAffinity {
    const fit = roleFit(resume, job, preferred);
    if (fit === "off-target") return fit;
    const { own, ownFamilies } = resumeTargets(resume, preferred);
    const title = job.title ?? "";
    if (own.some((phrase) => jobTitleMatchesTarget(title, phrase))) return "own";
    if (familiesNamedBy([title]).some((family) => ownFamilies.includes(family))) return "family";
    // A résumé that names no role of its own (skills only) has nothing to be "next to".
    if (fit === "target") return own.length > 0 ? "adjacent" : "family";
    return fit;
}

/** The candidate's role a posting is explained against: the own title it matched, else their first one. */
function yourRoleFor(resume: ResumeData, job: PublicJob, preferred: readonly string[] = []): string | null {
    const { own } = resumeTargets(resume, preferred);
    return own.find((phrase) => jobTitleMatchesTarget(job.title ?? "", phrase)) ?? own[0] ?? null;
}

/**
 * Which of the candidate's own kinds of role a posting belongs to, the one the
 * whole résumé leads with first. The kinds are the families their own titles
 * name (headline, current job, the title the summary opens with), ordered by
 * the résumé as a whole (`targetRoles().families`: headline, summary, skill
 * groups, then the current job). 0 is the leading kind; a title of none of
 * them ranks after all of them, except the candidate's own title, which is
 * theirs whatever family it names (or none). Skill groups alone never make a
 * kind of role theirs, they only decide between the ones that are.
 *
 * A résumé whose current job is "Product Manager" but whose summary and skills
 * lead with customer success is customer success first: its Customer Success
 * and TAM postings come before its Product Manager ones, which still count as
 * its own role. A résumé with one kind of role is unchanged.
 */
function familyRank(resume: ResumeData, job: PublicJob, role: RoleAffinity, preferred: readonly string[] = []): number {
    const { leading } = resumeTargets(resume, preferred);
    const ranks = familiesNamedBy([job.title ?? ""])
        .map((family) => leading.indexOf(family))
        .filter((rank) => rank >= 0);
    if (ranks.length > 0) return Math.min(...ranks);
    return role === "own" ? 0 : leading.length;
}

const ROLE_TIERS: readonly RoleAffinity[] = ["own", "family", "adjacent", "unverified", "off-target"];

/** After every scored posting, whatever its family rank. */
const UNSCORED_TIER = 10_000;

/** A role outside the candidate's countries (`MatchOutside`) ranks after every role they can take, in the same order among its own kind. */
const OUTSIDE_TIER = 1_000;

/** A role whose place can't be checked against theirs (`placeUnknown`) ranks after the roles they can take and before the ones outside. */
const PLACE_UNKNOWN_TIER = 500;

/** Their country, or where the role hires, is unknown: no evidence either way that they can take it. */
export function placeUnknown(score: MatchScore): boolean {
    return score.components.some((c) => c.key === "location" && c.unknown === true);
}

/**
 * Sort key for a ranked list, before the band and the score: the résumé's
 * leading family first (`familyRank`), and inside a family the candidate's own
 * role, then the same kind of role, then neighbours, then the rest. A role
 * outside the candidate's countries comes after all of those, in the same
 * order. A score without a role (built before roles were scored) sits with the
 * neighbours; no score at all sorts last.
 */
export function roleTier(score: MatchScore | null | undefined): number {
    if (!score) return UNSCORED_TIER;
    const tier = (score.familyRank ?? 0) * ROLE_TIERS.length + ROLE_TIERS.indexOf(score.role ?? "adjacent");
    if (score.outside) return OUTSIDE_TIER + tier;
    return placeUnknown(score) ? PLACE_UNKNOWN_TIER + tier : tier;
}

/**
 * A role that reads Stretch because it manages people the candidate hasn't
 * managed (`newToManaging`), or because it simply matches weakly, ranks after
 * every role they can take in their own countries, whatever its role tier:
 * role tier alone put the TAM résumé's Stretch "Manager, Technical Account
 * Management" above nine Strong Customer Success roles (review, 2026-10-13).
 * A role that is Stretch ONLY for asking one level more than the résumé shows
 * keeps its tier — the candidate's own title one step up is a stretch worth
 * seeing early (own-role-first.test.ts). Roles whose place is unknown or
 * outside their countries keep their own, later tiers.
 */
const STRETCH_TIER = 300;

function aboveLevelOnly(score: MatchScore): boolean {
    return !score.newToManaging && score.components.some((c) => c.key === "seniority" && c.reason === "level_below_ask");
}

/** `roleTier`, with in-country Stretch roles (other than own-role-one-level-up) after every in-country Good or Strong one. */
export function rankTier(score: MatchScore | null | undefined): number {
    const tier = roleTier(score);
    if (!score || tier >= PLACE_UNKNOWN_TIER) return tier;
    return matchBand(score.total) === "stretch" && !aboveLevelOnly(score) ? STRETCH_TIER + tier : tier;
}

const DAY_MS = 86_400_000;

/** Days for a posting's freshness credit to halve. */
export const FRESHNESS_HALF_LIFE_DAYS = 7;

/**
 * Fit points a posting gets for being new, halving every
 * `FRESHNESS_HALF_LIFE_DAYS`: +12 today, +6 at a week, +3 at two, under +1 at
 * a month. Early applicants are read first, so among roles that fit about as
 * well the newer one leads: yesterday's 90 now ranks above a 25-day-old 98,
 * while a 95 still ranks above a same-day 82. Ranking only — the fit score
 * and its band never change with age.
 */
export const FRESHNESS_RANK_POINTS = 12;

export function freshnessPoints(postedTs: number | null | undefined, nowMs: number): number {
    if (typeof postedTs !== "number" || !Number.isFinite(postedTs)) return 0;
    const days = Math.max(0, (nowMs - postedTs) / DAY_MS);
    return FRESHNESS_RANK_POINTS * Math.pow(0.5, days / FRESHNESS_HALF_LIFE_DAYS);
}

/**
 * Which week a posting is in: this week (0), last week (1), or older (2, or
 * unknown). Inside a fit band, a ranked list leads with this week's roles:
 * fit totals inside one band differ by title-word noise as often as by real
 * fit (a résumé that lacks the word "Enterprise" reads 2 of 3 terms), and
 * that noise put 21–28-day-old Strong roles above 6-day-old Strong ones for
 * the TAM résumé even with the freshness credit (review, 2026-10-13).
 */
export function postingWeek(postedTs: number | null | undefined, nowMs: number): number {
    if (typeof postedTs !== "number" || !Number.isFinite(postedTs)) return 2;
    const days = (nowMs - postedTs) / DAY_MS;
    return days <= 7 ? 0 : days <= 14 ? 1 : 2;
}

/**
 * The band a ranked list places a role in: its fit band, one band lower once
 * it is over two weeks old (`postingWeek` 2). A Strong role posted 28 days ago
 * ranks with this week's Good roles, not above them — by then most of its
 * applicants are in and many such roles are being filled. The label the role
 * shows never changes; only where it sits. Without a posting date the fit
 * band alone, as before.
 */
export function rankBand(score: MatchScore | null | undefined, postedTs?: number | null, nowMs: number = Date.now()): number {
    const band = BAND_RANK[matchBand(score?.total ?? -1)];
    if (postedTs === undefined || !score) return band;
    return Math.min(BAND_RANK.stretch, band + (postingWeek(postedTs, nowMs) === 2 ? 1 : 0));
}

/** The value a ranked list orders by inside a role tier and fit band: the fit total plus freshness. */
export function rankingValue(score: MatchScore | null | undefined, postedTs: number | null | undefined, nowMs: number): number {
    return (score?.total ?? -1) + (score ? freshnessPoints(postedTs, nowMs) : 0);
}

/** Ranked-list order: role tier (Stretch after the rest), then the higher total plus freshness. Stable sorts keep the incoming order on a tie. */
export function compareFit(
    a: MatchScore | null | undefined,
    b: MatchScore | null | undefined,
    aPostedTs?: number | null,
    bPostedTs?: number | null,
    nowMs: number = Date.now(),
): number {
    return rankTier(a) - rankTier(b) || rankingValue(b, bPostedTs, nowMs) - rankingValue(a, aPostedTs, nowMs);
}

const BAND_RANK: Record<MatchBand, number> = { strong: 0, good: 1, stretch: 2 };

/**
 * `compareFit` with the roles this device has already listed after the ones
 * it hasn't, inside the same role tier and fit band: a new Good role comes
 * before a Good one shown on earlier visits, never before a Strong one. In
 * score order alone the same top roles led every visit until they aged out
 * of the window ("I keep seeing the same result", 2026-10-06). With nothing
 * seen it is `compareFit` inside each band. Pass the postings' `posted_ts`
 * so this week's roles lead inside a band (`postingWeek`) and a newer role
 * leads among roles that fit about as well (`rankingValue`); without them the
 * order is by total alone, as before.
 */
export function compareFitUnseenFirst(
    a: MatchScore | null | undefined,
    b: MatchScore | null | undefined,
    aSeen: boolean,
    bSeen: boolean,
    aPostedTs?: number | null,
    bPostedTs?: number | null,
    nowMs: number = Date.now(),
): number {
    return (
        rankTier(a) - rankTier(b) ||
        rankBand(a, aPostedTs, nowMs) - rankBand(b, bPostedTs, nowMs) ||
        Number(aSeen) - Number(bSeen) ||
        (aPostedTs !== undefined || bPostedTs !== undefined ? postingWeek(aPostedTs, nowMs) - postingWeek(bPostedTs, nowMs) : 0) ||
        rankingValue(b, bPostedTs, nowMs) - rankingValue(a, aPostedTs, nowMs)
    );
}

/**
 * A posting for a different kind of role than the résumé targets is at most a
 * Stretch, however many words it shares with the résumé: "API" and "incident"
 * in a PM's bullets do not make the engineering job theirs. One whose title
 * can't be tied to the résumé's target (`unverified`) is never Strong.
 */
export function roleOffTarget(resume: ResumeData, job: PublicJob): boolean {
    return roleFit(resume, job) === "off-target";
}

/**
 * The one scoring function. `relevance` is REQUIRED — no topical overlap
 * between résumé and job means no honest match to report, so this returns
 * `null` (no chip). Seniority and location always contribute; when either is
 * unknown it contributes the neutral score and is flagged. A job whose
 * location cannot be verified for this candidate never reads as Strong: the
 * total is capped just under the Strong band (so is a job whose level was
 * never derived, for a candidate whose level is known — `levelUnverified` —
 * and a job whose title can't be tied to
 * the résumé's target role — `roleFit` "unverified"). A job for a different kind of role than the
 * résumé targets (`roleFit` "off-target") is capped under Good, and so is one
 * outside every country the candidate can work in, which also carries
 * `outside` so its label says so (`matchLabel`), and one above the
 * candidate's level (`jobLevel`): a role that asks for more than the résumé
 * shows is a Stretch, as the word says. Held only under Strong, an above-level
 * role read Good and outranked the roles at the candidate's level: a mid-level
 * TAM was shown a customer success job asking for 7+ years and 5+ years
 * managing a team as Good (2026-10-11). A role whose title manages people is
 * a Stretch too when no role or line on the résumé shows managing people
 * (`newToManaging`), whatever level the candidate is: "i dont have any
 * managerial experience...i think that should have been taken into account"
 * (2026-10-11).
 *
 * `signals` defaults to the résumé-only resolution; callers that hold the
 * candidate's saved preferences pass `resolveCandidateSignals(resume, prefs)`.
 */
export function scoreJobAgainstResume(
    resume: ResumeData,
    job: PublicJob,
    signals: CandidateSignals = resolveCandidateSignals(resume),
): MatchScore | null {
    const overlap = scoreRelevance(resume, job);
    if (!overlap) return null;
    const preferred = preferredRoles(signals);
    const role = roleAffinity(resume, job, preferred);
    const yourRole = yourRoleFor(resume, job, preferred);
    const offTarget = role === "off-target";
    const relevance = offTarget
        ? { ...overlap, detail: `${overlap.detail} · a different kind of role from yours` }
        : role === "adjacent"
          ? { ...overlap, detail: `${overlap.detail} · next to your role, not the same job` }
          : overlap;

    // A people manager's role for a résumé that shows no one managed: said beside the level, where the receipt names what it asks.
    const newToManaging = titleManagesPeople(job.title) && !resumeTargets(resume).managed;
    const seniority = scoreSeniority(signals, job);
    const components = [
        relevance,
        newToManaging ? { ...seniority, detail: `${seniority.detail} · ${newToManagingText(seniority.level)}` } : seniority,
        scoreLocation(signals, job),
    ];
    const weighted = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key] * c.score, 0);
    const total = Math.round((weighted / WEIGHT_SUM) * 100);
    const location = components[2]!;
    const abroad = location.reason != null && OUTSIDE_REASONS.has(location.reason);

    const rank = familyRank(resume, job, role, preferred);
    // A role above the candidate's level is a Stretch: a fit word would say they can take what its reason says they can't.
    // One step up for a long career that already led people or work (13 years, Team Lead and Senior
    // Engineer before 5 as a PM) is a reach, not a Stretch: Good at best (Vivek, 2026-10-13: the other
    // portals' picks for him were Senior PM roles, all of which read Stretch here).
    const reach = components[1]!.reason === "level_below_ask" && signals.seniority.source === "resume"
        && (role === "own" || role === "family") && signals.seniority.value === "mid" && jobLevelRead(job)?.level === "senior" && ledLongCareer(resume);
    const aboveLevel = components[1]!.reason === "level_below_ask" && !reach;
    const jdFit = components[0]!.jd?.fit;
    const thinJd = typeof jdFit === "number" && jdFit < JD_GOOD_MIN_FIT;
    const capped = offTarget || aboveLevel || newToManaging || thinJd
        ? Math.min(total, MATCH_BAND_GOOD_MIN - 1)
        : location.unknown || abroad || levelUnverified(signals, job) || role === "unverified" || role === "adjacent" || reach
          ? Math.min(total, MATCH_BAND_STRONG_MIN - 1)
          : total;
    const score: MatchScore = { total: capped, components, role, yourRole, familyRank: rank, ...(newToManaging ? { newToManaging: true as const } : {}), ...(reach ? { reach: true as const } : {}) };
    if (!abroad || !location.place) return score;
    return {
        ...score,
        total: Math.min(capped, MATCH_BAND_GOOD_MIN - 1),
        outside: {
            home: candidateCountries(signals),
            where: location.place.where,
            ...(location.place.currency ? { currency: location.place.currency } : {}),
            from: signals.location.source === "explicit" ? "settings" : "resume",
            total: capped,
        },
    };
}
