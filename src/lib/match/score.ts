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
    type CandidateSignals,
} from "@/lib/jobs/candidate-signals";
import { meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { payPlace } from "@/lib/jobs/pay-place";
import { jobCountries, titlePlace } from "@/lib/jobs/resume-location";
import { isUnknownFacetValue } from "@/lib/jobs/unknown-inclusive-facets";
import { jobTitleMatchesTarget } from "@/lib/jobs/for-you/title-relevance";
import { buildMatchQuery, targetRoles, topSkills, type Seniority } from "@/lib/jobs/resume-match";
import { familiesNamedBy, RANK_WORDS, resumeDutyTokens, type RoleFamilyId } from "@/lib/match/duty-signals";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export type MatchComponentKey = "relevance" | "seniority" | "location";

export interface MatchComponent {
    key: MatchComponentKey;
    label: string;
    /** Honest, computed verdict text — e.g. "7 of 12 terms this role names", "senior — fits". */
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
    /** Location only, for a role outside the candidate's countries: where it is, and the pay's currency when only the pay says so. */
    place?: { where: string; currency?: string };
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

function scoreRelevance(resume: ResumeData, job: PublicJob): MatchComponent | null {
    const jobVocab = jobVocabulary(job);
    const resumeVocab = resumeVocabulary(resume);
    if (jobVocab.size === 0 || resumeVocab.size === 0) return null;

    const matched = [...jobVocab].filter((token) => vocabHasToken(resumeVocab, token));
    const coverage = matched.length / jobVocab.size;
    const score = Math.min(1, coverage / RELEVANCE_COVERAGE_FLOOR);
    return {
        key: "relevance",
        label: "Relevance to this role",
        detail: `${matched.length} of ${jobVocab.size} terms this role names`,
        score,
        terms: { matched: matched.length, of: jobVocab.size },
    };
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

/** Candidate seniority vs a job's `experience_level`. Unknown on either side is neutral and flagged. */
function scoreSeniority(signals: CandidateSignals, job: PublicJob): MatchComponent {
    const own = signals.seniority.value;
    const jobIndex = EXPERIENCE_LEVEL_ORDER.indexOf(normalize(job.experience_level ?? "") as Seniority);
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
    const verdict = diff === 0 ? "fits" : diff > 0 ? "exceeds ask" : "below ask";
    const reason: MatchReason = diff === 0 ? "level_fits" : diff > 0 ? "level_above_ask" : "level_below_ask";
    return { key: "seniority", label: "Seniority", detail: `${SENIORITY_LABEL[own]} — ${verdict}`, score, reason };
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
}

/** Per résumé object: the role families it targets, the titles its packs search for, and its own role. */
const TARGETS = new WeakMap<ResumeData, ResumeTargets>();

function resumeTargets(resume: ResumeData): ResumeTargets {
    let targets = TARGETS.get(resume);
    if (!targets) {
        const roles = targetRoles(resume);
        targets = {
            families: roles.families,
            searched: buildMatchQuery(resume).phrases.map((phrase) => phrase.toLowerCase()),
            own: roles.own,
            ownFamilies: roles.ownFamilies,
            leading: [
                ...roles.families.filter((family) => roles.ownFamilies.includes(family)),
                ...roles.ownFamilies.filter((family) => !roles.families.includes(family)),
            ],
        };
        TARGETS.set(resume, targets);
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

export function roleFit(resume: ResumeData, job: PublicJob): RoleFit {
    const { families, searched } = resumeTargets(resume);
    const title = (job.title ?? "").toLowerCase();
    if (searched.some((phrase) => title.includes(phrase))) return "target";
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

export function roleAffinity(resume: ResumeData, job: PublicJob): RoleAffinity {
    const fit = roleFit(resume, job);
    if (fit === "off-target") return fit;
    const { own, ownFamilies } = resumeTargets(resume);
    const title = job.title ?? "";
    if (own.some((phrase) => jobTitleMatchesTarget(title, phrase))) return "own";
    if (familiesNamedBy([title]).some((family) => ownFamilies.includes(family))) return "family";
    // A résumé that names no role of its own (skills only) has nothing to be "next to".
    if (fit === "target") return own.length > 0 ? "adjacent" : "family";
    return fit;
}

/** The candidate's role a posting is explained against: the own title it matched, else their first one. */
function yourRoleFor(resume: ResumeData, job: PublicJob): string | null {
    const { own } = resumeTargets(resume);
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
function familyRank(resume: ResumeData, job: PublicJob, role: RoleAffinity): number {
    const { leading } = resumeTargets(resume);
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

/** Ranked-list order: role tier, then the higher total. Stable sorts keep the incoming order on a tie. */
export function compareFit(a: MatchScore | null | undefined, b: MatchScore | null | undefined): number {
    return roleTier(a) - roleTier(b) || (b?.total ?? -1) - (a?.total ?? -1);
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
 * and a job whose title can't be tied to the résumé's target role —
 * `roleFit` "unverified"). A job for a different kind of role than the
 * résumé targets (`roleFit` "off-target") is capped under Good, and so is one
 * outside every country the candidate can work in, which also carries
 * `outside` so its label says so (`matchLabel`).
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
    const role = roleAffinity(resume, job);
    const yourRole = yourRoleFor(resume, job);
    const offTarget = role === "off-target";
    const relevance = offTarget
        ? { ...overlap, detail: `${overlap.detail} · a different kind of role from yours` }
        : role === "adjacent"
          ? { ...overlap, detail: `${overlap.detail} · next to your role, not the same job` }
          : overlap;

    const components = [relevance, scoreSeniority(signals, job), scoreLocation(signals, job)];
    const weighted = components.reduce((sum, c) => sum + MATCH_WEIGHTS[c.key] * c.score, 0);
    const total = Math.round((weighted / WEIGHT_SUM) * 100);
    const location = components[2]!;
    const abroad = location.reason != null && OUTSIDE_REASONS.has(location.reason);

    const rank = familyRank(resume, job, role);
    const capped = offTarget
        ? Math.min(total, MATCH_BAND_GOOD_MIN - 1)
        : location.unknown || abroad || levelUnverified(signals, job) || role === "unverified" || role === "adjacent"
          ? Math.min(total, MATCH_BAND_STRONG_MIN - 1)
          : total;
    const score: MatchScore = { total: capped, components, role, yourRole, familyRank: rank };
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
