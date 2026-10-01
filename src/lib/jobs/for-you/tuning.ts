/**
 * "More / fewer like this" for an opened pack's role stack (Vivek, 2026-09-30:
 * like a feed, "gently nudging", "akin to a filter knob they dont have to
 * manually tweak"). One tap on a role nudges which roles come next. It never
 * hides a role and never asks a question. Apply, Save, opening the posting,
 * Skip and time spent reading a role nudge too, more gently. Nudges stay on
 * this device and fade (half-life `HALF_LIFE_MS`), so an old preference stops
 * steering on its own, and "Reset" drops them all.
 *
 * A nudge remembers what the role was, not only its id: the words of its
 * title (rank words dropped, so "Senior TAM" and "TAM II" are one role), its
 * tags, the skills it lists, role family, company, level, work type and
 * country. Each is weighed by how rare it is among the roles in the deck, as a
 * search engine weighs terms, so what a role shares with the whole deck says
 * nothing and what sets it apart says the most. For a Technical Account
 * Manager whose deck is all TAM roles, "fewer like this" on "Technical Account
 * Manager, Security" means fewer security roles, not fewer TAM roles (Vivek,
 * 2026-09-30: "I dont want cyber sec jobs"). A role coming up is nudged by how
 * much of that standout weight it carries.
 *
 * The deck moves a nudged role by its nudge times what is left to see
 * (`maxShift`): a close match from far down comes up next, a loose one edges
 * forward, and nothing the visitor has already passed moves.
 *
 * Works for any role or industry: it reads titles, skills and the posting's
 * own fields, with no role list of its own. Pure, no I/O; the store is
 * tuning-store.ts.
 */
import { familiesNamedBy, RANK_WORDS } from "@/lib/match/duty-signals";
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
    /** The role as its title names it: "Technical Account Manager". */
    role: string;
    /** What set it apart in the deck it was seen in, for the summary line: the role, a
     *  word of its title ("Security"), its company or a skill. */
    label: string;
    /** Kind-prefixed terms: `w:` title word, `g:` tag, `s:` skill, `f:` role family,
     *  `c:` company, `l:` level, `t:` work type, `k:` country. */
    terms: string[];
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

function titleWords(title: string): string[] {
    return meaningfulTitleTokens(title).filter((word) => !RANK_WORDS.has(word));
}

/** A posting's terms, as `RoleFeatures.terms`. */
export function roleTerms(job: PublicJob): string[] {
    const country = Array.isArray(job.location_country) ? job.location_country[0] : job.location_country;
    const terms = [
        ...titleWords(decodeText(job.title)).map((word) => `w:${word}`),
        ...(job.tags ?? []).map((tag) => lower(tag)).filter(Boolean).map((tag) => `g:${tag}`),
        ...[...(job.must_have_skills ?? []), ...(job.tech_stack ?? [])]
            .map((skill) => lower(skill))
            .filter(Boolean)
            .slice(0, 16)
            .map((skill) => `s:${skill}`),
        ...familiesNamedBy([job.title ?? ""]).map((family) => `f:${family}`),
        ...[
            ["c", job.company],
            ["l", job.experience_level],
            ["t", job.work_type],
            ["k", country],
        ]
            .map(([kind, value]) => (lower(value) ? `${kind}:${lower(value)}` : null))
            .filter(Boolean),
    ] as string[];
    return [...new Set(terms)];
}

/**
 * How much each kind of term says about a role. The title is what a visitor
 * reads and reacts to, so it says the most; the company less (a "fewer" on
 * "Software Engineer, Backend" is about backend roles more than about that
 * employer); level, work type and country least.
 */
const KIND_WEIGHT: Readonly<Record<string, number>> = { w: 1, g: 0.6, s: 0.5, c: 0.35, f: 0.3, l: 0.2, t: 0.2, k: 0.2 };

/**
 * Term weights for one deck: a kind's weight times how rare the term is among
 * `deck` (log of deck size over the roles carrying it). A term every role has
 * weighs nothing; one no role in the deck has weighs nothing either, since it
 * can't steer this deck.
 */
export function deckTermWeights(deck: readonly (readonly string[])[]): (term: string) => number {
    const counts = new Map<string, number>();
    for (const terms of deck) for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    const n = deck.length;
    const weights = new Map<string, number>();
    return (term) => {
        let weight = weights.get(term);
        if (weight === undefined) {
            const count = counts.get(term) ?? 0;
            weight = count === 0 ? 0 : (KIND_WEIGHT[term.slice(0, 1)] ?? 0.2) * Math.log((n + 1) / count);
            weights.set(term, weight);
        }
        return weight;
    };
}

function titleCase(word: string, title: string): string {
    const match = decodeText(title).match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
    return match ? match[0] : word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * What a nudge remembers about `job`. Given the deck it was seen in, `label` is
 * the term that most sets it apart from the other roles there (only terms some
 * other role shares, since only those steer the deck): its role when that is a
 * word of the role ("Product Manager" in a TAM's deck), else that word
 * ("Security"), its company or a skill.
 */
export function roleFeatures(job: PublicJob, deck: readonly PublicJob[] = []): RoleFeatures {
    const role = roleName(job.title);
    const terms = roleTerms(job);
    let label = role;
    const others = deck.filter((other) => other.id !== job.id);
    if (others.length > 0) {
        const weight = deckTermWeights(others.map(roleTerms));
        const roleWords = new Set(titleWords(role));
        const best = terms
            .filter((term) => /^[wcsg]:/.test(term) && weight(term) > 0)
            .sort((a, b) => weight(b) - weight(a))[0];
        if (best && !(best.startsWith("w:") && roleWords.has(best.slice(2)))) {
            const value = best.slice(2);
            label = best.startsWith("w:")
                ? titleCase(value, job.title ?? "")
                : best.startsWith("c:")
                  ? (job.company ?? value).trim()
                  : value;
        }
    }
    return { role, label, terms };
}

/** How much a nudge given `ageMs` ago still counts. */
export function decay(ageMs: number): number {
    return Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
}

/**
 * How much of what sets `nudged` apart `candidate` also carries, 0 to 1: the
 * squared weight of the terms they share over that of all the nudged role's
 * terms. Squared so the term that most sets a role apart leads, and a handful
 * of weak ones (a tag, a level, the company) can't outvote it: "fewer" on
 * "Software Engineer, Backend" moves backend roles, not every role that shares
 * its React tag.
 */
export function similarity(candidate: readonly string[], nudged: readonly string[], weight: (term: string) => number): number {
    let total = 0;
    let shared = 0;
    const has = new Set(candidate);
    for (const term of nudged) {
        const w = weight(term) ** 2;
        total += w;
        if (has.has(term)) shared += w;
    }
    return total > 0 ? shared / total : 0;
}

/** Below this two roles share too little (a level, a work type) for a nudge to carry over. */
const SIMILARITY_FLOOR = 0.25;

/** The net nudge on one role, from -1 (fewer) to 1 (more). */
export function roleNudge(
    terms: readonly string[],
    nudges: readonly TuningNudge[],
    nowMs: number,
    weight: (term: string) => number,
): number {
    let total = 0;
    for (const nudge of nudges) {
        const strength = SIGNAL_WEIGHT[nudge.signal] * decay(nowMs - nudge.at);
        if (Math.abs(strength) < 0.01) continue;
        const alike = similarity(terms, nudge.features.terms, weight);
        if (alike <= SIMILARITY_FLOOR) continue;
        total += strength * ((alike - SIMILARITY_FLOOR) / (1 - SIMILARITY_FLOOR));
    }
    return Math.max(-1, Math.min(1, total));
}

/**
 * The furthest a fully nudged role moves: the length of what is left to see
 * (at least 12 places). A tap is a deliberate ask, so "fewer like this" on a
 * role that fills the deck lets the other roles through, and "more like this"
 * brings its close matches up from anywhere. A quieter signal moves roles by
 * its share of that: reading a role a while ("dwell", 0.15) a few places.
 */
export function maxShift(remaining: number): number {
    return Math.max(12, remaining);
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

    const terms = rest.map(roleTerms);
    // The deck's vocabulary leaves out the nudged roles themselves: a term only
    // they carry steers nothing, so it must not water down the terms that do.
    const nudged = new Set(nudges.map((nudge) => nudge.jobId));
    const weight = deckTermWeights(terms.filter((_, index) => !nudged.has(rest[index].id)));
    const shift = maxShift(rest.length);
    const keyed = rest.map((job, index) => ({
        job,
        index,
        key: index - shift * roleNudge(terms[index], nudges, nowMs, weight),
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

/** A label named in the summary once its nudges add up to this, either way. */
const SUMMARY_MIN = 0.75;

export interface TuningSummary {
    toward: string[];
    away: string[];
}

/** What the deck leans toward and away from (each nudge's `label`), strongest first, two of each at most. */
export function summarizeTuning(nudges: readonly TuningNudge[], nowMs: number): TuningSummary | null {
    const roles = new Map<string, { name: string; sum: number }>();
    for (const nudge of nudges) {
        const name = nudge.features.label;
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
