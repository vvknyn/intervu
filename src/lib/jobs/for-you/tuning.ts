/**
 * "More / fewer like this" for an opened pack's role stack (Vivek, 2026-09-30:
 * like a feed, "gently nudging", "akin to a filter knob they dont have to
 * manually tweak"). One tap on a role nudges which roles come next. It never
 * hides a role and never asks a question. Apply, Save, opening the posting,
 * Skip and time spent reading a role nudge too, more gently. Nudges stay on
 * this device and fade (half-life `HALF_LIFE_MS`), so an old preference stops
 * steering on its own, and "Reset" drops them all.
 *
 * A nudge remembers what the role was, not only its id: its title words (rank
 * words dropped, so "Senior TAM" and "TAM II" are one role), role families,
 * the skills it lists, company, level, work type and country. A role coming
 * up is nudged by how much it resembles each, the title counting most. Title
 * words are weighted by how rare they are in the deck, as a search engine
 * weighs terms: "manager" in 40 of 60 titles says little, "account" says more.
 *
 * The deck moves a nudged role by at most half of what is left to see
 * (`maxShift`): a strong match from further down comes up next, a weak one
 * edges forward, and nothing the visitor has already passed moves.
 *
 * Works for any role or industry: it reads titles, skills and the posting's
 * own fields, with no role list of its own. Pure, no I/O; the store is
 * tuning-store.ts.
 */
import { familiesNamedBy, RANK_WORDS, type RoleFamilyId } from "@/lib/match/duty-signals";
import { decodeText, meaningfulTitleTokens } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

export type TuningSignal = "more" | "fewer" | "apply" | "save" | "open" | "dwell" | "skip";

/** How hard each signal pushes. A tap says the most; reading a role a while says little. */
export const SIGNAL_WEIGHT: Readonly<Record<TuningSignal, number>> = {
    more: 1,
    fewer: -1,
    apply: 0.6,
    save: 0.5,
    open: 0.3,
    dwell: 0.15,
    skip: -0.3,
};

const EXPLICIT: ReadonlySet<TuningSignal> = new Set(["more", "fewer"]);

/** A nudge counts half as much after two weeks. */
export const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
/** Past this a nudge is a sixty-fourth of itself: dropped. */
export const NUDGE_MAX_AGE_MS = 6 * HALF_LIFE_MS;
export const MAX_NUDGES = 80;

/** What a nudge remembers about the role it was given on. */
export interface RoleFeatures {
    /** The role as the summary names it: "Technical Account Manager". */
    role: string;
    /** That role's title words, lowercased, rank words dropped. */
    words: string[];
    families: RoleFamilyId[];
    skills: string[];
    company: string | null;
    level: string | null;
    workType: string | null;
    country: string | null;
}

export interface TuningNudge {
    jobId: string;
    signal: TuningSignal;
    /** Epoch ms. */
    at: number;
    features: RoleFeatures;
}

const QUALIFIER_SPLIT = /\s+[-–—|]\s+|\s*[,(|:]\s*/;

function rankWord(word: string): boolean {
    return RANK_WORDS.has(word.toLowerCase().replace(/[^a-z-]/g, ""));
}

/**
 * The role a title names, without its rank or qualifiers: "Sr. Technical
 * Account Manager, Enterprise - Europe" → "Technical Account Manager".
 */
export function roleName(title: string | null | undefined): string {
    const decoded = decodeText(title).trim();
    const head = decoded.split(QUALIFIER_SPLIT)[0]?.trim() || decoded;
    const words = head.split(/\s+/).filter(Boolean);
    let start = 0;
    let end = words.length;
    while (start < end && rankWord(words[start])) start += 1;
    while (end > start && rankWord(words[end - 1])) end -= 1;
    return words.slice(start, end).join(" ") || head;
}

function lower(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim().toLowerCase();
    return trimmed ? trimmed : null;
}

function firstCountry(value: PublicJob["location_country"]): string | null {
    return lower(Array.isArray(value) ? value[0] : value);
}

export function roleFeatures(job: PublicJob): RoleFeatures {
    const role = roleName(job.title);
    const skills = [...(job.must_have_skills ?? []), ...(job.tech_stack ?? [])]
        .map((skill) => skill.trim().toLowerCase())
        .filter(Boolean);
    return {
        role,
        words: [...new Set(meaningfulTitleTokens(role).filter((word) => !RANK_WORDS.has(word)))],
        families: familiesNamedBy([job.title ?? ""]),
        skills: [...new Set(skills)].slice(0, 16),
        company: lower(job.company),
        level: lower(job.experience_level),
        workType: lower(job.work_type),
        country: firstCountry(job.location_country),
    };
}

/** How much a nudge given `ageMs` ago still counts. */
export function decay(ageMs: number): number {
    return Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
}

/** "manager" is "managers"; a short word ("it", "ux") has to be itself. */
function sameWord(a: string, b: string): boolean {
    if (a === b) return true;
    return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/** Title word weights for one deck: rarer words weigh more (inverse document frequency). */
export function titleWordWeights(roles: readonly RoleFeatures[]): (word: string) => number {
    const counts = new Map<string, number>();
    for (const role of roles) for (const word of role.words) counts.set(word, (counts.get(word) ?? 0) + 1);
    const n = Math.max(1, roles.length);
    const weights = new Map<string, number>();
    return (word) => {
        let weight = weights.get(word);
        if (weight === undefined) {
            weight = Math.log(1 + n / (counts.get(word) ?? 1));
            weights.set(word, weight);
        }
        return weight;
    };
}

function titleSimilarity(a: string[], b: string[], weight: (word: string) => number): number {
    if (a.length === 0 || b.length === 0) return 0;
    const total = [...a, ...b].reduce((sum, word) => sum + weight(word), 0);
    if (total <= 0) return 0;
    const shared =
        a.filter((word) => b.some((other) => sameWord(word, other))).reduce((sum, word) => sum + weight(word), 0) +
        b.filter((word) => a.some((other) => sameWord(word, other))).reduce((sum, word) => sum + weight(word), 0);
    return shared / total;
}

function overlap<T>(a: readonly T[], b: readonly T[]): number | null {
    if (a.length === 0 || b.length === 0) return null;
    const shared = a.filter((item) => b.includes(item)).length;
    return (2 * shared) / (a.length + b.length);
}

function equal(a: string | null, b: string | null): number | null {
    return a == null || b == null ? null : a === b ? 1 : 0;
}

/** Title first; the rest only adds when both roles state it. */
const PARTS: readonly [number, (a: RoleFeatures, b: RoleFeatures) => number | null][] = [
    [0.15, (a, b) => overlap(a.families, b.families)],
    [0.15, (a, b) => overlap(a.skills, b.skills)],
    [0.1, (a, b) => equal(a.company, b.company)],
    [0.04, (a, b) => equal(a.level, b.level)],
    [0.03, (a, b) => equal(a.workType, b.workType)],
    [0.03, (a, b) => equal(a.country, b.country)],
];
const TITLE_PART = 0.5;

/** 0 (nothing alike) to 1 (the same role at the same company). */
export function similarity(a: RoleFeatures, b: RoleFeatures, weight: (word: string) => number): number {
    let sum = TITLE_PART * titleSimilarity(a.words, b.words, weight);
    let parts = TITLE_PART;
    for (const [part, score] of PARTS) {
        const value = score(a, b);
        if (value == null) continue;
        sum += part * value;
        parts += part;
    }
    return sum / parts;
}

/** Below this two roles share too little (a level, a country) for a nudge to carry over. */
const SIMILARITY_FLOOR = 0.25;

/** The net nudge on one role, from -1 (fewer) to 1 (more). */
export function roleNudge(
    role: RoleFeatures,
    nudges: readonly TuningNudge[],
    nowMs: number,
    weight: (word: string) => number,
): number {
    let total = 0;
    for (const nudge of nudges) {
        const strength = SIGNAL_WEIGHT[nudge.signal] * decay(nowMs - nudge.at);
        if (Math.abs(strength) < 0.01) continue;
        const alike = similarity(role, nudge.features, weight);
        if (alike <= SIMILARITY_FLOOR) continue;
        total += strength * ((alike - SIMILARITY_FLOOR) / (1 - SIMILARITY_FLOOR));
    }
    return Math.max(-1, Math.min(1, total));
}

/**
 * The furthest a fully nudged role moves: half of what is left to see, at least
 * 12 places. One tap on a role brings the close matches in the next dozen
 * forward; a reading pause ("dwell", 0.15) moves them a few places.
 */
export function maxShift(remaining: number): number {
    return Math.max(12, Math.round(remaining / 2));
}

/**
 * The deck in the order to show it: the roles already reached (`passedIds`,
 * in that order), then the rest in their ranked order, each moved up or down
 * by its nudge. Returns `jobs` itself when nothing changes.
 */
export function tuneDeck<T extends PublicJob>(
    jobs: T[],
    nudges: readonly TuningNudge[],
    passedIds: readonly string[],
    nowMs: number,
): T[] {
    if (nudges.length === 0 && passedIds.length === 0) return jobs;
    const byId = new Map(jobs.map((job) => [job.id, job]));
    const head = passedIds.map((id) => byId.get(id)).filter((job): job is T => job != null);
    const passed = new Set(head.map((job) => job.id));
    const rest = jobs.filter((job) => !passed.has(job.id));
    if (nudges.length === 0) return head.length === 0 ? jobs : [...head, ...rest];

    const features = rest.map(roleFeatures);
    const weight = titleWordWeights([...features, ...nudges.map((nudge) => nudge.features)]);
    const shift = maxShift(rest.length);
    const keyed = rest.map((job, index) => ({
        job,
        index,
        key: index - shift * roleNudge(features[index], nudges, nowMs, weight),
    }));
    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    const tuned = keyed.map((entry) => entry.job);
    if (head.length === 0 && tuned.every((job, index) => job === jobs[index])) return jobs;
    return [...head, ...tuned];
}

/**
 * Fold a new nudge in, newest first, one per role: a tap replaces whatever the
 * role had; a quieter signal never overrides a tap or a stronger signal.
 */
export function addNudge(list: readonly TuningNudge[], nudge: TuningNudge, nowMs = nudge.at): TuningNudge[] {
    const existing = list.find((item) => item.jobId === nudge.jobId);
    if (existing && !EXPLICIT.has(nudge.signal)) {
        if (EXPLICIT.has(existing.signal)) return [...list];
        if (Math.abs(SIGNAL_WEIGHT[existing.signal]) >= Math.abs(SIGNAL_WEIGHT[nudge.signal])) return [...list];
    }
    return [nudge, ...list.filter((item) => item.jobId !== nudge.jobId)]
        .filter((item) => nowMs - item.at < NUDGE_MAX_AGE_MS)
        .slice(0, MAX_NUDGES);
}

export function removeNudge(list: readonly TuningNudge[], jobId: string): TuningNudge[] {
    return list.filter((item) => item.jobId !== jobId);
}

/** A role named in the summary once its nudges add up to this, either way. */
const SUMMARY_MIN = 0.75;

export interface TuningSummary {
    toward: string[];
    away: string[];
}

/** The roles the deck leans toward and away from, strongest first, two of each at most. */
export function summarizeTuning(nudges: readonly TuningNudge[], nowMs: number): TuningSummary | null {
    const roles = new Map<string, { name: string; sum: number }>();
    for (const nudge of nudges) {
        const name = nudge.features.role;
        const key = name.toLowerCase();
        if (!key) continue;
        const entry = roles.get(key) ?? { name, sum: 0 };
        entry.sum += SIGNAL_WEIGHT[nudge.signal] * decay(nowMs - nudge.at);
        roles.set(key, entry);
    }
    const all = [...roles.values()];
    const toward = all.filter((role) => role.sum >= SUMMARY_MIN).sort((a, b) => b.sum - a.sum);
    const away = all.filter((role) => role.sum <= -SUMMARY_MIN).sort((a, b) => a.sum - b.sum);
    if (toward.length === 0 && away.length === 0) return null;
    return { toward: toward.slice(0, 2).map((role) => role.name), away: away.slice(0, 2).map((role) => role.name) };
}

function joinNames(names: string[]): string {
    return names.length < 2 ? (names[0] ?? "") : `${names[0]} and ${names[1]}`;
}

/** "Tuned toward Technical Account Manager, away from Product Manager." */
export function tuningLine(summary: TuningSummary): string {
    const parts = [
        summary.toward.length > 0 ? `toward ${joinNames(summary.toward)}` : null,
        summary.away.length > 0 ? `away from ${joinNames(summary.away)}` : null,
    ].filter(Boolean);
    return `Tuned ${parts.join(", ")}.`;
}

/**
 * The roles reached once the visitor is on `index`: everything up to it, or
 * further if they had already been further and stepped back. Tuning never
 * moves these again.
 */
export function reachedIds(deck: readonly { id: string }[], passedIds: readonly string[], index: number): readonly string[] {
    const passed = new Set(passedIds);
    let reached = 0;
    while (reached < deck.length && passed.has(deck[reached].id)) reached += 1;
    const through = Math.max(index + 1, reached);
    if (through <= reached) return passedIds;
    return deck.slice(0, Math.min(through, deck.length)).map((job) => job.id);
}
