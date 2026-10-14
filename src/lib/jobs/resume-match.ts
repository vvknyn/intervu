/**
 * Resume → search intent.
 *
 * The jobs corpus is searched with Meilisearch (keyword, not semantic — see
 * lib/jobs/meilisearch.ts), so a resume can't be "matched" by similarity. These
 * pure helpers translate a parsed `ResumeData` into the same `{ q, facets }`
 * shape the search action already takes:
 *
 *   - Rank / `sort=fit` — generalized role-title retrieval via `buildMatchQuery`
 *     (experience titles + duty-inferred families + headline splits, capped);
 *     scoring on returned hits remains `scoreJobAgainstResume` in lib/match/score.ts.
 *   - Explore — adjacent roles; `suggestAdjacentRolesLocal` (adjacent-roles.ts)
 *               is the deterministic no-LLM helper; `buildExploreBroadenQuery`
 *               is the skills-only fallback used on /jobs today.
 *
 * Type-only imports keep this module runtime-dependency-free so it loads under
 * `tsx` for unit tests without `@/` path resolution.
 */
import {
    dutyDerivedRoleTitles,
    familiesNamedBy,
    familyRetrievalTitles,
    type RoleFamilyId,
} from "@/lib/match/duty-signals";
import type { ResumeData } from "@/types/resume";
import type { FacetKey } from "./types";
import { splitRoleTitles, suggestAdjacentRolesLocal } from "./adjacent-roles";
import { isRoleTitlePhrase } from "@/lib/resume/title-text";
import { formatQuotedOrQuery } from "./fit-phrases";
import { resumeIndustry, type IndustryId } from "./resume-industry";
import { computeYearsOfExperience } from "@/lib/resume/years-of-experience";
import { titleLevel } from "./role-level";
import { meaningfulTitleTokens } from "./presentation";
import { jobTitleMatchesTarget } from "./for-you/title-relevance";

export interface DerivedQuery {
    q: string;
    facets: Partial<Record<FacetKey, string[]>>;
    /** Capped role/skill phrases before quoted-OR serialization into `q`. */
    phrases: string[];
}

/** `experience_level` facet values are exactly entry | mid | senior | unknown. */
export type Seniority = "entry" | "mid" | "senior";

/** Map years of experience to a seniority facet value. 0 / unknown → null (no facet). */
export function seniorityFromYears(years: number): Seniority | null {
    if (!Number.isFinite(years) || years <= 0) return null;
    if (years <= 2) return "entry";
    if (years <= 6) return "mid";
    return "senior";
}

const SENIORITY_ORDER: readonly Seniority[] = ["entry", "mid", "senior"];

/**
 * The candidate's level in their own line of work: the years in roles of the
 * same kind as the one they hold now (their headline and latest role, by
 * `familiesNamedBy`), never above what their whole career reads. Employers
 * ask for years in the role, so 13 years of which 5 are as a Technical
 * Account Manager after 8 in engineering is a mid-level TAM, and senior TAM
 * roles are above them; counting all 13 read them as senior and filled their
 * picks with senior roles (2026-10-06). The same for any change of line: a
 * nurse who became a teacher, an engineer who became a product manager.
 * When the latest role names no kind we know, or its dates can't be read,
 * the whole career decides, as before. A title held now that names a level
 * sets it instead, higher or lower than those years: a title means the same
 * level on a résumé as on a posting (`titleLevel`), so the candidate's own
 * title never reads above them ("Senior Accountant", "Manager, Customer
 * Success"), and an intern, trainee, apprentice or junior is entry level
 * however long the dates run. A "Data Science Intern" since 2021 read as mid,
 * and the Mid filter emptied their list (focus group, 2026-10-12).
 */
export function resumeSeniority(resume: ResumeData | null | undefined, now: Date = new Date()): Seniority | null {
    return resumeSeniorityBasis(resume, now)?.level ?? null;
}

/** What `resumeSeniority` read the level from, for the reason a role shows: "your 5 years as a Technical Account Manager". */
export interface SeniorityBasis {
    level: Seniority;
    /** The years the level comes from. */
    years: number;
    /** The role held now, when the years are those in that line of work; `null` when they are the whole career. */
    role: string | null;
    /** Which `experience` entries (by index) the years were counted from, when `role` is set: the review marks them. */
    roles?: number[];
    /** The title held now, when it names a level other than the years' and so sets `level` (`titleLevel`). */
    title?: string;
    /**
     * Carried up one level by a long career that led people or work (`ledLongCareer`): the candidate
     * also fits the level below, the one their years in the line held now read.
     */
    led?: true;
}

export function resumeSeniorityBasis(resume: ResumeData | null | undefined, now: Date = new Date()): SeniorityBasis | null {
    const basis = yearsSeniorityBasis(resume, now);
    if (!basis) return null;
    const held = (resume?.experience?.[0]?.role ?? "").trim();
    const titled = titleLevel(held);
    if (!titled || titled.level === basis.level) return basis;
    return { ...basis, level: titled.level, title: held };
}

/** A title that led people or work: "Team Lead", "Technology Lead", "Senior Software Engineer". */
const LED_TITLE = /\b(?:lead|senior|sr\.?|principal|staff|head|manager|director)\b/i;
/** A career this long with such a title in it carries a level up into a new line of work. */
const LED_CAREER_MIN_YEARS = 8;

/** The level from years alone: in the candidate's line of work, never above their whole career. */
function yearsSeniorityBasis(resume: ResumeData | null | undefined, now: Date): SeniorityBasis | null {
    const careerYears = resume?.profile?.yearsOfExperience ?? 0;
    const overall = seniorityFromYears(careerYears);
    if (!overall) return null;
    const career: SeniorityBasis = { level: overall, years: careerYears, role: null };
    const experience = resume?.experience ?? [];
    const line = familiesNamedBy([resume?.profile?.profession ?? "", experience[0]?.role ?? ""].filter(Boolean));
    if (line.length === 0) return career;
    const roles = experience.flatMap((entry, index) =>
        familiesNamedBy([entry.role ?? ""]).some((family) => line.includes(family)) ? [index] : [],
    );
    const inLine = roles.map((index) => experience[index]!);
    const years = computeYearsOfExperience(inLine, now);
    if (years == null) return career;
    const own = seniorityFromYears(Math.max(years, 1))!;
    if (SENIORITY_ORDER.indexOf(own) >= SENIORITY_ORDER.indexOf(overall)) return career;
    // Total years plus leadership: a long career that already led people or work carries a level up
    // into a new line of work. 5 years as a PM after Senior Engineer, Team Lead and Technology Lead
    // roles (13 years in all) is a senior candidate (Vivek, 2026-10-13: the other portals' picks were
    // all Senior, Staff or Head of Product).
    if (resume && ledLongCareer(resume)) {
        const up = SENIORITY_ORDER[Math.min(SENIORITY_ORDER.indexOf(own) + 1, SENIORITY_ORDER.indexOf(overall))]!;
        return { level: up, years: careerYears, role: null, led: true };
    }
    return { level: own, years, role: (inLine[0]?.role ?? "").trim() || null, roles };
}

/**
 * The `experience_level` facet values a candidate at `seniority` retrieves.
 * Senior candidates often fit adjacent mid-level PM/TAM/CSM postings; senior-only
 * would hide most of those titles from Rank retrieval.
 */
export function experienceLevelFacet(seniority: Seniority | null, resume?: ResumeData | null): string[] | null {
    // A long career that already led people or work also retrieves one level up when the level comes
    // from fewer years in a new line of work: 5 years as a PM after Senior Engineer, Team Lead and
    // Technology Lead roles (13 years in all). Vivek, 2026-10-13: every pick other portals sent him was
    // Senior, Staff or Head of Product, and the mid-only search hid them all. Scoring keeps its level.
    if (seniority === "mid" && resume && ledLongCareer(resume)) return ["mid", "senior"];
    if (seniority === "senior") return ["mid", "senior"];
    return seniority ? [seniority] : null;
}

/** A career of `LED_CAREER_MIN_YEARS` or more with a title that led people or work in it. */
export function ledLongCareer(resume: ResumeData): boolean {
    if ((resume.profile?.yearsOfExperience ?? 0) < LED_CAREER_MIN_YEARS) return false;
    return (resume.experience ?? []).slice(1).some((entry) => LED_TITLE.test(entry.role ?? ""));
}

/** A past role that ended this many years ago no longer says what the candidate does now. */
export const STALE_ROLE_YEARS = 5;

/** The last year a role's dates name ("Present"/"Current" is `nowYear`); null when they name none. */
export function roleEndYear(dates: string, nowYear: number): number | null {
    if (/\b(present|current|now)\b/i.test(dates)) return nowYear;
    const full = [...dates.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    const short = [...dates.matchAll(/['‘’](\d{2})\b/g)].map((m) => 2000 + Number(m[1]));
    const years = [...full, ...short];
    return years.length > 0 ? Math.max(...years) : null;
}

/**
 * Distinct experience role titles in résumé order (most recent first). The
 * most recent role always counts; an earlier one only while it is recent
 * (`STALE_ROLE_YEARS`) — or when its dates name no year, since an unknown
 * end is not evidence of an old role.
 */
function experienceRoleTitles(resume: ResumeData, nowYear?: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const [index, entry] of (resume?.experience ?? []).entries()) {
        const role = (entry?.role ?? "").trim();
        if (!role) continue;
        if (nowYear !== undefined && index > 0) {
            const ended = roleEndYear(entry?.dates ?? "", nowYear);
            if (ended !== null && nowYear - ended >= STALE_ROLE_YEARS) continue;
        }
        const key = role.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(role);
    }
    return out;
}

/** Drop common prefixes when the remainder is still a meaningful role phrase. */
function cleanRoleTitle(title: string): string {
    const trimmed = title.trim();
    const shortened = trimmed.replace(/^(client-facing|senior)\s+/i, "").trim();
    return shortened || trimmed;
}

/** A headline names a practice ("Technical Account Management"); a posting names the job ("Technical Account Manager"). */
function headlineRoleTitle(title: string): string {
    return cleanRoleTitle(title).replace(/\bManagement$/, "Manager");
}

/** The title a summary opens with: "Senior Customer Success and Technical Account Manager with 12 years…". */
function summaryLeadTitle(summary: string): string {
    const first = (summary ?? "").trim().split(/[.;:\n]/)[0] ?? "";
    return first.split(/\s+(?:with|who|having|driving|focused)\b|,/i)[0]?.trim() ?? "";
}

/** Self-description a summary's first title can open with ("Experienced software engineer"). */
const LEAD_ADJECTIVES = /^(?:(?:highly|seasoned|experienced|accomplished|results-driven|dedicated|passionate|skilled|certified|versatile|strategic|motivated)\s+)+/i;

/**
 * Titles after the first that the summary's lead joins, kept only when the
 * résumé's experience lines name that title word for word (case aside).
 */
export function evidencedSecondaryTitles(resume: ResumeData, lead: string): string[] {
    const parts = joinedTitles(lead).slice(1);
    if (parts.length === 0) return [];
    const body = (resume?.experience ?? [])
        .map((e) => `${e?.role ?? ""} ${e?.description ?? ""}`)
        .join(" ")
        .toLowerCase();
    const out: string[] = [];
    for (const part of parts) {
        const title = cleanRoleTitle(part.replace(LEAD_ADJECTIVES, ""));
        if (!title || !isRoleTitlePhrase(title) || familiesNamedBy([title]).length === 0) continue;
        // Held, not described: "serve as named Technical Account Manager", "as the Product Owner".
        const escaped = title.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const held = new RegExp(`\\b(?:as|named)\\s+(?:an?\\s+|the\\s+|named\\s+)*${escaped}\\b`);
        const roleHeld = (resume?.experience ?? []).some((e) => cleanRoleTitle(e?.role ?? "").toLowerCase() === title.toLowerCase());
        if (roleHeld || held.test(body)) out.push(title);
    }
    return out;
}

/** "Technical Account Manager and client-facing product owner" → the two titles it joins. */
function joinedTitles(phrase: string): string[] {
    return phrase
        .split(/\s+(?:and|&)\s+/i)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * The families `phrases` name, in the order the phrases name them. A summary
 * that opens "Technical Account Manager and client-facing product owner" is
 * customer success first, product second; `familiesNamedBy` alone returns its
 * own fixed family order, which put product first and filled a TAM's pack with
 * Product Manager roles.
 */
function familiesInOrder(phrases: string[]): RoleFamilyId[] {
    return [...new Set([...phrases.flatMap(joinedTitles).flatMap((part) => familiesNamedBy([part])), ...familiesNamedBy(phrases)])];
}

export interface TargetRoles {
    /** Role titles in the candidate's own words: the headline they wrote, then their current role. */
    phrases: string[];
    /** Role families the headline, summary, skill groups and current role name, strongest first. */
    families: RoleFamilyId[];
    /**
     * The roles the candidate calls themselves: `phrases` plus the title their
     * summary opens with ("Senior Customer Success and Technical Account
     * Manager…" → Customer Success). A posting with one of these titles is their
     * own role; one that only shares a family with them is a neighbour.
     */
    own: string[];
    /** The families `own` names, strongest first. */
    ownFamilies: RoleFamilyId[];
    /**
     * Roles the candidate said they want that nothing on the résumé shows them
     * holding (Vivek, 2026-10-14: "Customer Success Manager" stated beside a
     * TAM and product-owner career). They are still searched; a posting with
     * one of these titles is a neighbour, not their own role.
     */
    statedUnheld: string[];
}

/**
 * What the candidate is looking for, from the résumé's own words, strongest
 * first: the headline they wrote (unless it only repeats their current job
 * title), their current role, and the role families their summary and skill
 * groups name. An old role, or a duty that sounds like another job ("API",
 * "incident" in a product manager's bullets), is not a target.
 */
export function targetRoles(resume: ResumeData, preferred: readonly string[] = []): TargetRoles {
    const current = (resume?.experience ?? []).map((e) => (e?.role ?? "").trim()).find(Boolean) ?? "";
    const profession = (resume?.profile?.profession ?? "").trim();
    const headlineIsJobTitle = Boolean(current) && profession.toLowerCase() === current.toLowerCase();
    const headline = profession && !headlineIsJobTitle ? splitRoleTitles(profession).map(headlineRoleTitle) : [];
    const currentTitle = current ? cleanRoleTitle(current) : "";
    // Roles the candidate SAID they want (Settings › Roles, setup's roles step) lead: they are the
    // clearest statement of intent there is. Before 2026-10-13 they were saved, shown as a chip on
    // For you, and read by nothing that searched or scored.
    const stated = preferred.map((p) => stripWorkMode(p)).filter(Boolean);

    const phrases: string[] = [];
    for (const phrase of [...stated, ...headline, currentTitle].map(stripWorkMode)) {
        if (phrase && !phrases.some((p) => p.toLowerCase() === phrase.toLowerCase())) phrases.push(phrase);
    }
    const lead = summaryLeadTitle(resume?.generatedSummary ?? "");
    const categories = (resume?.competencies ?? []).map((group) => (group?.category ?? "").trim()).filter(Boolean);
    const families = [
        ...new Set([
            ...familiesInOrder(stated),
            ...familiesInOrder(headline),
            ...familiesInOrder(lead ? [lead] : []),
            ...familiesInOrder(categories),
            ...familiesInOrder(currentTitle ? [currentTitle] : []),
        ]),
    ];

    // Only the title the summary OPENS with is the candidate's own: in "Technical
    // Account Manager and client-facing product owner" the second half describes
    // the job, it is not a second job they are after.
    const leadTitle = cleanRoleTitle((joinedTitles(lead)[0] ?? "").replace(LEAD_ADJECTIVES, ""));
    const leadIsTitle = Boolean(leadTitle) && isRoleTitlePhrase(leadTitle) && familiesNamedBy([leadTitle]).length > 0;
    // A stated role is their own only when the résumé shows them holding it (`heldTitles`);
    // the headline and current role are theirs by definition.
    // A stated role in another line of work is a move they are making (a PM asking for Data Analyst) and leads as
    // their own; one next to a role they hold, in the same family, that they have never held (Customer Success
    // Manager beside Technical Account Manager) is a neighbour.
    const held = heldTitles(resume, leadIsTitle ? leadTitle : "");
    const heldFamilies = new Set(held.flatMap((h) => familiesNamedBy([h])));
    const statedUnheld = stated.filter(
        (p) => !titleIsHeld(p, held) && familiesNamedBy([p]).some((family) => heldFamilies.has(family)),
    );
    const own = phrases.filter((p) => !statedUnheld.some((u) => u.toLowerCase() === p.toLowerCase()));
    // A title held for years inside a joined current role ("Technical Account Manager (Client-Facing
    // Product Owner)", five years) is theirs as much as the headline's first title (2026-10-14).
    for (const title of yearsBackedTitles(resume)) {
        if (!own.some((p) => p.toLowerCase() === title.toLowerCase())) own.push(title);
    }
    if (leadIsTitle && !own.some((p) => p.toLowerCase() === leadTitle.toLowerCase())) own.push(leadTitle);
    // A second title the summary joins counts too when the résumé's body backs it: Vivek's
    // "Product Manager and Technical Account Manager" whose current role says "Serve as named
    // Technical Account Manager" is both (2026-10-13: "use the ENTIRE résumé"). Without that
    // evidence the second half describes the job, as before.
    for (const title of evidencedSecondaryTitles(resume, lead)) {
        if (!phrases.some((p) => p.toLowerCase() === title.toLowerCase())) phrases.push(title);
        if (!own.some((p) => p.toLowerCase() === title.toLowerCase())) own.push(title);
    }
    return {
        phrases,
        families: [...new Set([...families, ...familiesInOrder(own)])],
        own,
        ownFamilies: familiesByYears(resume, familiesInOrder(own)),
        statedUnheld,
    };
}

/** Titles that name the same job: a posting says one, a résumé the other. */
const SAME_JOB_TITLES: readonly [RegExp, string][] = [
    [/\bproduct owner\b/i, "product manager"],
    [/\bproduct manager\b/i, "product owner"],
];

/** The titles the résumé shows the candidate holding: every role (and the title it joins in brackets), the headline, the summary's lead. */
function heldTitles(resume: ResumeData, leadTitle: string): string[] {
    const out: string[] = [];
    const add = (t: string) => {
        const title = cleanRoleTitle(stripWorkMode(t));
        if (title && !out.some((o) => o.toLowerCase() === title.toLowerCase())) out.push(title);
    };
    for (const entry of resume?.experience ?? []) for (const part of roleTitleParts(entry?.role ?? "")) add(part);
    for (const part of splitRoleTitles(resume?.profile?.profession ?? "").flatMap(roleTitleParts)) add(headlineRoleTitle(part));
    if (leadTitle) add(leadTitle);
    return out;
}

/** "Technical Account Manager (Client-Facing Product Owner)" → it and the two titles it joins. */
function roleTitleParts(role: string): string[] {
    const whole = role.trim();
    if (!whole) return [];
    const inner = [...whole.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!.trim());
    const outer = whole.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    return [...new Set([whole, outer, ...inner, ...joinedTitles(outer), ...inner.flatMap(joinedTitles)].filter(Boolean))];
}

/** Whether a stated role names a title the candidate holds (or the same job under another name). */
function titleIsHeld(stated: string, held: readonly string[]): boolean {
    const variants = [stated, ...SAME_JOB_TITLES.filter(([re]) => re.test(stated)).map(([re, to]) => stated.replace(re, to))];
    return held.some((h) => variants.some((v) => jobTitleMatchesTarget(h, v) || jobTitleMatchesTarget(v, h)));
}

/** A joined title held this long counts as the candidate's own role. */
export const OWN_TITLE_MIN_YEARS = 2;

/** Whole years a role's dates span ("September 2021 — Present" → 5 in 2026); null when they name no start year. */
export function roleSpanYears(dates: string, nowYear: number): number | null {
    const years = [...(dates ?? "").matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => Number(m[0]));
    if (years.length === 0) return null;
    const end = roleEndYear(dates, nowYear) ?? years[years.length - 1]!;
    return Math.max(0, end - Math.min(...years));
}

/** Bracketed or joined titles in a recent role held `OWN_TITLE_MIN_YEARS` or more, with the posting-side name for the same job. */
function yearsBackedTitles(resume: ResumeData): string[] {
    const nowYear = new Date().getFullYear();
    const out: string[] = [];
    for (const entry of (resume?.experience ?? []).slice(0, 1)) {
        const span = roleSpanYears(entry?.dates ?? "", nowYear);
        if (span == null || span < OWN_TITLE_MIN_YEARS) continue;
        const parts = roleTitleParts(entry?.role ?? "").slice(1).map((p) => cleanRoleTitle(p)).filter((p) => isRoleTitlePhrase(p) && familiesNamedBy([p]).length > 0);
        for (const part of parts) {
            for (const t of [part, ...SAME_JOB_TITLES.filter(([re]) => re.test(part)).map(([re, to]) => part.replace(re, to))]) {
                const title = t.replace(/\b\w/g, (c) => c.toUpperCase());
                if (!out.some((o) => o.toLowerCase() === title.toLowerCase())) out.push(title);
            }
        }
    }
    return out;
}

/** The own families, the one held longest first (a tie keeps the résumé's order): years in the role, not the headline alone. */
function familiesByYears(resume: ResumeData, families: RoleFamilyId[]): RoleFamilyId[] {
    if (families.length < 2) return families;
    const nowYear = new Date().getFullYear();
    const years = new Map<RoleFamilyId, number>();
    for (const entry of resume?.experience ?? []) {
        const span = roleSpanYears(entry?.dates ?? "", nowYear) ?? 0;
        const named = new Set(roleTitleParts(entry?.role ?? "").flatMap((p) => familiesNamedBy([p])));
        for (const f of named) years.set(f, (years.get(f) ?? 0) + span);
    }
    return families
        .map((f, i) => ({ f, i, y: years.get(f) ?? 0 }))
        .sort((a, b) => b.y - a.y || a.i - b.i)
        .map((x) => x.f);
}

/**
 * Work-mode words are where a job is done, not what it is: "Remote Customer
 * Support Specialist" searched as a phrase made every pack lane require the
 * word "remote" in the title, and the search's query understanding read it
 * as a work_type=remote filter on the WHOLE pack (review, 2026-10-13). The
 * candidate's remote preference is its own signal (`remotePreference`).
 */
const WORK_MODE_WORDS = /\b(?:remote|hybrid|on[- ]?site|in[- ]office|work[- ]from[- ]home|wfh|telecommute|virtual)\b/gi;

export function stripWorkMode(title: string): string {
    const stripped = (title ?? "")
        .replace(WORK_MODE_WORDS, " ")
        .replace(/[()[\]]\s*[()[\]]/g, " ")
        .replace(/\s*[-–—|,/]\s*$/g, "")
        .replace(/^\s*[-–—|,/]\s*/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return stripped || (title ?? "").trim();
}

/**
 * A stated roles answer as a list of titles: "Data Analyst, BI Analyst or
 * Analytics Engineer" → the three. Split on commas, semicolons, slashes,
 * bars, new lines and a standalone "or"; never on "and", which joins words
 * inside one title ("Sales and Marketing Manager").
 */
export function splitPreferredRoles(text: string | null | undefined): string[] {
    const out: string[] = [];
    for (const part of (text ?? "").split(/[,;|\n/]+|\s+or\s+/i)) {
        const role = correctRoleTypos(stripWorkMode(part.replace(/^["'\s]+|["'\s.]+$/g, "")));
        if (role && !out.some((r) => r.toLowerCase() === role.toLowerCase())) out.push(role);
    }
    return out;
}

/** Words job titles are made of, to set a misspelt stated role right ("Product Mangager", 2026-10-14). */
const TITLE_WORDS = [
    "manager", "management", "product", "technical", "account", "customer", "success", "engineer", "engineering",
    "analyst", "developer", "designer", "director", "owner", "program", "project", "solutions", "specialist",
    "consultant", "architect", "coordinator", "administrator", "representative", "scientist", "marketing",
    "operations", "support", "executive", "associate", "principal", "platform", "software", "security",
    "implementation", "delivery", "partner", "strategist", "researcher",
];

function editDistance(a: string, b: string): number {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
}

/** A stated role with each misspelt title word (six letters or more) set right when one edit away: "Producer" stays. */
export function correctRoleTypos(role: string): string {
    return role.replace(/[A-Za-z]{6,}/g, (word) => {
        const lower = word.toLowerCase();
        if (TITLE_WORDS.includes(lower)) return word;
        const max = 1;
        let best: string | null = null;
        let bestD = max + 1;
        for (const w of TITLE_WORDS) {
            const dist = Math.abs(w.length - lower.length) > max ? max + 1 : editDistance(lower, w);
            if (dist < bestD) [best, bestD] = [w, dist];
        }
        if (!best) return word;
        return word[0] === word[0]!.toUpperCase() ? best[0]!.toUpperCase() + best.slice(1) : best;
    });
}

/**
 * A headline or role that names no job a posting carries: "Health Science
 * Graduate", "Clinic Volunteer". Searched as a phrase it finds nothing and
 * spends one of the pack's four slots.
 */
const NOT_A_JOB_TITLE = /\b(graduate|student|volunteer|candidate)\s*$/i;

const isJobTitle = (phrase: string) => !NOT_A_JOB_TITLE.test(phrase.trim());

/**
 * `suggestAdjacentRolesLocal` is a table of software and go-to-market jumps
 * (any "manager" → Engineering Manager, any "analyst" → Business Analyst), so
 * it only speaks for résumés in those industries. A Nurse Manager's pack must
 * not search Engineering Manager.
 */
const ADJACENCY_INDUSTRIES: ReadonlySet<IndustryId> = new Set(["tech", "business"]);

/**
 * Match / Rank (`sort=fit`): the role titles a pack searches for, strongest
 * first, capped at 4 (see `capExploreTerms`):
 *
 *   1. the candidate's own words — their headline, then their current role;
 *   2. the standard titles of the role families the résumé names
 *      ("Customer Success Manager", "Technical Account Manager");
 *   3. earlier roles that are still recent (`STALE_ROLE_YEARS`);
 *   4. roles adjacent to the targets (`suggestAdjacentRolesLocal`), for tech
 *      and go-to-market résumés only (`ADJACENCY_INDUSTRIES`);
 *   5. families inferred from duties alone (`dutyDerivedRoleTitles`);
 *   6. top skills, only when nothing else produced a query.
 *
 * Titles 2, 4 and 5 are added only when they are close to the résumé's own
 * (`closeToOwn`): a Customer Success Manager's search added "Product Manager"
 * and a web developer's "Backend Engineer" (focus group, 2026-10-12).
 * Headlines and roles that aren't job titles (`NOT_A_JOB_TITLE`) are skipped.
 * Seniority widens to mid+senior so adjacent mid-level roles stay visible.
 * `resumeIsUsable` is defined in terms of this function's output (see
 * resume-usable.ts) precisely so the two can't drift apart again.
 */
export function buildMatchQuery(
    resume: ResumeData,
    nowYear: number = new Date().getFullYear(),
    preferred: readonly string[] = [],
): DerivedQuery {
    const skills = topSkills(resume, 6);
    const target = targetRoles(resume, preferred);
    const ownTitles = target.phrases.filter(isJobTitle);
    const recentTitles = experienceRoleTitles(resume, nowYear).map(cleanRoleTitle).map(stripWorkMode).filter(isJobTitle);
    const close = closeToOwn([...ownTitles, ...recentTitles], target.ownFamilies);
    const ownFamilyTitles = new Set(familyRetrievalTitles(target.ownFamilies));

    let terms = capExploreTerms(
        // A family's own standard titles count as that family's, whatever its title patterns say.
        [...ownTitles, ...familyRetrievalTitles(target.families).filter((t) => ownFamilyTitles.has(t) || close(t)), ...recentTitles],
        4,
    );
    if (terms.length < 4 && ownTitles.length > 0 && ADJACENCY_INDUSTRIES.has(resumeIndustry(resume))) {
        terms = capExploreTerms([...terms, ...suggestAdjacentRolesLocal(ownTitles, skills, 8).filter(close)], 4);
    }
    if (terms.length < 4) {
        terms = capExploreTerms([...terms, ...dutyDerivedRoleTitles(resume).filter(close)], 4);
    }
    if (terms.length === 0) {
        terms = capExploreTerms(skills, 4);
    }

    const q = formatQuotedOrQuery(terms);
    const facets: Partial<Record<FacetKey, string[]>> = {};
    const levels = experienceLevelFacet(resumeSeniority(resume));
    if (levels) facets.experience_level = levels;
    return { q, facets, phrases: terms };
}

/**
 * Words that name a rank or a generic job rather than a line of work: two titles
 * sharing only "Manager" ("Customer Success Manager", "Implementation Manager")
 * are not the same job.
 */
const GENERIC_TITLE_WORDS = new Set([
    "manager", "management", "specialist", "coordinator", "assistant", "associate", "officer", "representative",
    "administrator", "consultant", "lead", "head", "director", "senior", "sr", "junior", "jr", "principal", "staff",
    "intern", "internship", "trainee", "apprentice", "graduate", "student", "i", "ii", "iii", "iv",
]);

/** A title's words that name its line of work: "data" and "science" in "Data Science Intern". */
function lineWords(title: string): string[] {
    return meaningfulTitleTokens(title).filter((word) => !GENERIC_TITLE_WORDS.has(word));
}

/**
 * Whether a title the search would add is close to the résumé's own titles: it
 * names one of the role families they name (a Customer Success Manager's
 * "Technical Account Manager"), or, where one side names no family we know, it
 * shares a word of their line of work (a Data Scientist's "Research Scientist",
 * a Data Science Intern's "Data Analyst", a Graphic Designer's "UX Designer").
 * A title of another family than the résumé's ("Product Manager" for a CSM) is
 * not, nor one sharing only a generic word ("Operations Manager" for an HR
 * Generalist). With no own title to compare, every title is kept: the search
 * has nothing else to go on.
 */
function closeToOwn(own: string[], named: RoleFamilyId[]): (title: string) => boolean {
    const ownFamilies = new Set([...named, ...familiesNamedBy(own)]);
    const words = new Set(own.flatMap(lineWords));
    return (title) => {
        if (own.length === 0) return true;
        const families = familiesNamedBy([title]);
        if (families.some((family) => ownFamilies.has(family))) return true;
        if (families.length > 0 && ownFamilies.size > 0) return false;
        return lineWords(title).some((word) => words.has(word));
    };
}

/** Flatten competencies into a de-duped (case-insensitive), trimmed skill list, capped at `n`. */
export function topSkills(resume: ResumeData, n = 8): string[] {
    const out: string[] = [];
    for (const group of resume?.competencies ?? []) {
        for (const raw of group?.skills ?? []) {
            const skill = (raw ?? "").trim();
            if (!skill) continue;
            if (out.some((s) => s.toLowerCase() === skill.toLowerCase())) continue;
            out.push(skill);
            if (out.length >= n) return out;
        }
    }
    return out;
}

/**
 * Cap an ORDERED list of explore-query candidates — AI-suggested adjacent
 * titles, or the skills-only fallback below — to the `max` most significant
 * (earliest-ranked) entries. Both callers already hand this a
 * significance-ordered list (the LLM ranks titles by relevance; `topSkills`
 * walks the résumé's own competency order), so keeping a short prefix keeps
 * the query's most meaningful terms.
 *
 * Cap exists so Rank emits a short phrase list; retrieval ORs those phrases
 * via the fit-phrase multi-search lane (`fit-phrases.ts` / `searchMeili`),
 * never by space-joining into one AND query. Space-joining 6–8 titles
 * previously produced AND-of-all-tokens mush under `matchingStrategy: "all"`.
 * Deduping case-insensitively here also stops a repeated term from silently
 * eating one of the 4 slots.
 */
export function capExploreTerms(terms: string[], max = 4): string[] {
    const out: string[] = [];
    for (const raw of terms) {
        const term = (raw ?? "").trim();
        if (!isRoleTitlePhrase(term)) continue;
        if (out.some((t) => t.toLowerCase() === term.toLowerCase())) continue;
        out.push(term);
        if (out.length >= max) break;
    }
    return out;
}

/**
 * Explore fallback: skills-only, role/seniority dropped → a wider, related net.
 * Used when the AI adjacency call fails or returns nothing.
 */
export function buildExploreBroadenQuery(resume: ResumeData): DerivedQuery {
    const terms = capExploreTerms(topSkills(resume, 6));
    return { q: terms.join(" "), facets: {}, phrases: terms };
}

/** Union résumé-derived facets with already-applied ones — commutative, non-mutating. */
export function mergeFacets(
    current: Partial<Record<FacetKey, string[]>>,
    derived: Partial<Record<FacetKey, string[]>>,
): Partial<Record<FacetKey, string[]>> {
    const merged: Partial<Record<FacetKey, string[]>> = { ...current };
    for (const key of Object.keys(derived) as FacetKey[]) {
        const fromDerived = derived[key];
        if (!fromDerived?.length) continue;
        const existing = merged[key] ?? [];
        const seen = new Set(existing);
        const union = [...existing];
        for (const v of fromDerived) {
            if (!seen.has(v)) {
                seen.add(v);
                union.push(v);
            }
        }
        merged[key] = union.sort();
    }
    return merged;
}
