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
 * component whose denominator is the JOB's own vocabulary (title + tags +
 * occupation + hydrated description when present, rank words stripped), not
 * the résumé's. The résumé side compares skills, profession, role titles, and
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
import { jobCountries } from "@/lib/jobs/resume-location";
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
}

export interface MatchScore {
    /** 0-100 integer. */
    total: number;
    components: MatchComponent[];
    /** How the posting's title relates to the roles the résumé names (`roleAffinity`). */
    role?: RoleAffinity;
    /** The candidate's own role as the résumé names it: the one the posting matched, else their main one. */
    yourRole?: string | null;
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

/**
 * `PublicJob.experience_level`'s real vocabulary, in ladder order — also the
 * candidate's (`Seniority`, resume-match.ts). A job value not in this list,
 * including "unknown", has no index, so the comparison is unknown rather
 * than guessed. Matched on the VALUE itself (indexOf), not by enumerating
 * "unknown" as a special case.
 */
const EXPERIENCE_LEVEL_ORDER: readonly Seniority[] = ["entry", "mid", "senior"];

/** SERP hits usually omit description; cap keeps detail/hydrated jobs cheap. */
const JOB_DESCRIPTION_SLICE_CHARS = 1500;
const JOB_DESCRIPTION_MAX_TOKENS = 32;

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
 * A job's own topical vocabulary: title + tags + occupation, plus a bounded
 * slice of `description` when it is already present (detail / hydrated hit).
 * SERP Meili hits typically omit description — this path is a no-op for them.
 */
function jobVocabulary(job: PublicJob): Set<string> {
    const tokens = [
        ...relevanceTokens(job.title ?? ""),
        ...(job.tags ?? []).flatMap((tag) => relevanceTokens(tag)),
        ...relevanceTokens(job.occupation ?? ""),
    ];
    const description = job.description?.trim();
    if (description) {
        const slice = description.slice(0, JOB_DESCRIPTION_SLICE_CHARS);
        tokens.push(...relevanceTokens(slice).slice(0, JOB_DESCRIPTION_MAX_TOKENS));
    }
    return new Set(tokens);
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
    };
}

function isRemoteWorkType(workType: string | null | undefined): boolean {
    return /remote/i.test(workType ?? "");
}

const locationComponent = (detail: string, score: number, unknown?: boolean): MatchComponent => ({
    key: "location",
    label: "Location",
    detail,
    score,
    ...(unknown ? { unknown } : {}),
});

/**
 * Candidate location vs job location. Same country is 1; a country the
 * candidate said they would relocate to is 0.8; another country is 0.35 (0.65
 * when the role is remote). A role that is remote with no country is open to
 * anyone. When the candidate's country or the job's country is unknown the
 * component is neutral and flagged `unknown` — never guessed.
 */
function scoreLocation(signals: CandidateSignals, job: PublicJob): MatchComponent {
    const remote = isRemoteWorkType(job.work_type);
    const jobList = jobCountries(job);
    if (remote && jobList.length === 0) return locationComponent("remote — open to any location", 1);
    if (signals.remotePreference.value && remote) return locationComponent("remote — matches your remote-only preference", 1);

    const own = candidateCountries(signals);
    if (own.length === 0) {
        return locationComponent(
            signals.location.value ? "your résumé's place names no country we can match" : "no location on your résumé",
            UNKNOWN_COMPONENT_SCORE,
            true,
        );
    }
    if (jobList.length === 0) {
        return locationComponent("this role's country isn't listed", UNKNOWN_COMPONENT_SCORE, true);
    }
    if (own.some((country) => jobList.includes(country))) {
        return locationComponent(remote ? "remote — same country" : "same country", 1);
    }
    const relocation = signals.relocation.value;
    if (relocation?.open && (relocation.countries.length === 0 || relocation.countries.some((c) => jobList.includes(c)))) {
        return locationComponent("in a country you said you'd relocate to", 0.8);
    }
    return remote
        ? locationComponent(`remote — based in ${jobList.join(", ")}`, 0.65)
        : locationComponent("different country", 0.35);
}

const SENIORITY_LABEL: Record<Seniority, string> = { entry: "entry-level", mid: "mid-level", senior: "senior" };

/** Candidate seniority vs a job's `experience_level`. Unknown on either side is neutral and flagged. */
function scoreSeniority(signals: CandidateSignals, job: PublicJob): MatchComponent {
    const own = signals.seniority.value;
    const jobIndex = EXPERIENCE_LEVEL_ORDER.indexOf(normalize(job.experience_level ?? "") as Seniority);
    const unknown = (detail: string): MatchComponent => ({
        key: "seniority",
        label: "Seniority",
        detail,
        score: UNKNOWN_COMPONENT_SCORE,
        unknown: true,
    });
    if (!own) return unknown("no years of experience on your résumé");
    if (jobIndex === -1) return unknown("this role's level isn't listed");

    const diff = EXPERIENCE_LEVEL_ORDER.indexOf(own) - jobIndex;
    const score = diff === 0 ? 1 : diff > 0 ? 0.65 : 0.25;
    const verdict = diff === 0 ? "fits" : diff > 0 ? "exceeds ask" : "below ask";
    return { key: "seniority", label: "Seniority", detail: `${SENIORITY_LABEL[own]} — ${verdict}`, score };
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
    return fit === "target" ? "adjacent" : fit;
}

/** The candidate's role a posting is explained against: the own title it matched, else their first one. */
function yourRoleFor(resume: ResumeData, job: PublicJob): string | null {
    const { own } = resumeTargets(resume);
    return own.find((phrase) => jobTitleMatchesTarget(job.title ?? "", phrase)) ?? own[0] ?? null;
}

const ROLE_TIERS: readonly RoleAffinity[] = ["own", "family", "adjacent", "unverified", "off-target"];

/**
 * Sort key for a ranked list, before the band and the score: the candidate's own
 * role, then the same kind of role, then neighbours, then the rest. A score
 * without a role (built before roles were scored) sits with the neighbours; no
 * score at all sorts last.
 */
export function roleTier(score: MatchScore | null | undefined): number {
    if (!score) return ROLE_TIERS.length;
    return ROLE_TIERS.indexOf(score.role ?? "adjacent");
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
 * résumé targets (`roleFit` "off-target") is capped under Good.
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
    const locationUnknown = components.some((c) => c.key === "location" && c.unknown);

    if (offTarget) return { total: Math.min(total, MATCH_BAND_GOOD_MIN - 1), components, role, yourRole };
    const capped = locationUnknown || levelUnverified(signals, job) || role === "unverified" || role === "adjacent";
    return { total: capped ? Math.min(total, MATCH_BAND_STRONG_MIN - 1) : total, components, role, yourRole };
}
