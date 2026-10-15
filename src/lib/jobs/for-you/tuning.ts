/**
 * "More / fewer like this" for an opened pack's role stack (Vivek, 2026-09-30:
 * like a feed, "gently nudging", "akin to a filter knob they dont have to
 * manually tweak"). One tap on a role nudges which roles come next. It never
 * hides a role. After a tap the visitor MAY say why (`TuningReason`, review
 * 2026-10-13: "more/less like this should give reasons and take that as
 * input"): the tap works on its own, a reason only narrows what the nudge
 * steers by (`REASON_KINDS`). Apply, Save, opening the posting,
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
 * forward, and nothing the visitor has already passed moves. A nudge never
 * takes a role out of its fit band, and never lifts a title the résumé does
 * not hold above one it does (`TuneRank`): "fewer like this" on a Product
 * Manager role put SecOps and Salesforce administration roles above a Product
 * Manager résumé's own roles on a list of eleven (Vivek, 2026-10-15).
 *
 * Works for any role or industry: it reads titles, skills and the posting's
 * own fields, with no role list of its own. Pure, no I/O; the store is
 * tuning-store.ts.
 */
import { familiesNamedBy, RANK_WORDS } from "@/lib/match/duty-signals";
import { decodeText, evidencedSkills, meaningfulTitleTokens } from "@/lib/jobs/presentation";
import { titleLevel } from "@/lib/jobs/role-level";
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
     *  `c:` company, `l:` listed level, `v:` level its title names, `t:` work type,
     *  `k:` country, `p:` city. */
    terms: string[];
    /** The role was the candidate's own kind of role (match/score.ts `roleAffinity`
     *  "own"). A thumbs-down or skip on it then steers by what else set it apart,
     *  not by the role itself (`OWN_DOWN_MIN_WEIGHT`). */
    own?: boolean;
}

/**
 * Why the visitor tapped "more" or "fewer", when they say. Without one the
 * nudge guesses from what set the role apart in its deck; with one it steers
 * by exactly that and nothing else:
 *  - `role`    the kind of job (its title words and role family)
 *  - `level`   its seniority (listed level, the level its title names)
 *  - `place`   where it is (country, city) and how (remote / hybrid / onsite)
 *  - `company` the employer
 *  - `field`   the area or skills inside the job ("Security", "Salesforce")
 *  - `done`    "fewer" only: already applied, seen it, or the posting looks stale —
 *              this posting goes, nothing about it steers what comes next
 */
export type TuningReason = "role" | "level" | "place" | "company" | "field" | "done";

export const TUNING_REASONS: readonly TuningReason[] = ["role", "level", "place", "company", "field", "done"];

/** The reasons offered after each tap, in the order shown. */
export const REASONS_FOR: Readonly<Record<"more" | "fewer", readonly TuningReason[]>> = {
    fewer: ["role", "level", "place", "company", "field", "done"],
    more: ["role", "level", "place", "company", "field"],
};

/** How each reason reads on its button, per tap. */
export const REASON_TEXT: Readonly<Record<"more" | "fewer", Partial<Record<TuningReason, string>>>> = {
    fewer: {
        role: "Not my kind of role",
        level: "Wrong level",
        place: "Location or remote",
        company: "This company",
        field: "The field or skills",
        done: "Applied or stale",
    },
    more: {
        role: "My kind of role",
        level: "Right level",
        place: "Location or remote",
        company: "This company",
        field: "The field or skills",
    },
};

export interface TuningNudge {
    jobId: string;
    signal: TuningSignal;
    /** Epoch ms. */
    at: number;
    features: RoleFeatures;
    /** Why, when the visitor said (`TuningReason`). */
    reason?: TuningReason;
}

/**
 * Which kinds of term (`RoleFeatures.terms`) each reason steers by. `naming`:
 * only the words that name the role; `notNaming`: only the title words that
 * don't (the "Security" in "Technical Account Manager, Security").
 */
const REASON_KINDS: Readonly<Record<TuningReason, { kinds: ReadonlySet<string>; words?: "naming" | "notNaming" }>> = {
    role: { kinds: new Set(["w", "f"]), words: "naming" },
    level: { kinds: new Set(["l", "v"]) },
    place: { kinds: new Set(["k", "p", "t"]) },
    company: { kinds: new Set(["c"]) },
    field: { kinds: new Set(["w", "g", "s"]), words: "notNaming" },
    done: { kinds: new Set() },
};

const QUALIFIER_SPLIT = /\s+[-–—|]\s+|\s*[,(|:]\s*/;

function rankWord(word: string): boolean {
    return RANK_WORDS.has(word.toLowerCase().replace(/[^a-z-]/g, ""));
}

/**
 * Words of a title or a tag that say where or how a role is worked, or on what terms, not what the work is:
 * "Remote" in "Product Manager (Remote)" read as a kind of role, and "away from Product Manager and Remote"
 * was the line a Product Manager's own taps produced (Vivek, 2026-10-15). They are never a tune term or a
 * label: where a role is stays with its own terms (`k:` country, `p:` city, `t:` work type), steered by the
 * "Location or remote" reason. Region words are listed here; a city, state or country in a title is read from
 * the posting's own location (`locationWords`), so no list of places is needed.
 */
const NON_ROLE_WORDS: ReadonlySet<string> = new Set([
    // How it is worked.
    "remote", "remotely", "remote-first", "hybrid", "onsite", "on-site", "wfh", "anywhere",
    // On what terms (not "contract": a Contract Manager is a kind of role).
    "permanent", "temporary", "temp", "freelance", "part-time", "parttime", "full-time", "fulltime", "seasonal", "casual",
    // Where (not "global" or "international": a Global Mobility Manager is a kind of role).
    "emea", "apac", "latam", "amer", "americas", "nordics", "dach", "anz", "europe", "european", "asia", "africa", "usa", "us", "uk", "canada", "canadian",
]);

const nonRoleWord = (word: string): boolean => NON_ROLE_WORDS.has(word.toLowerCase().replace(/[^a-z-]/g, ""));

/** The words of the places a posting names (its city, state, country, location line). */
function locationWords(job: PublicJob): Set<string> {
    const country = Array.isArray(job.location_country) ? job.location_country.join(" ") : job.location_country;
    return new Set(
        [job.location, job.location_city, job.location_state, country]
            .flatMap((place) => meaningfulTitleTokens(decodeText(place ?? "")))
            .filter((word) => word.length >= 3),
    );
}

/** Titles that open on the post and name the work after it: "Director, Technical Account Management". */
const POST_FIRST = new Set(["director", "head", "manager", "supervisor", "officer", "president", "vice president", "vp", "svp", "evp", "avp"]);

/**
 * The role a title names, without its rank or qualifiers: "Sr. Technical
 * Account Manager, Enterprise - Europe" → "Technical Account Manager". A title
 * that opens on the post keeps the work it names: "Director, Technical Account
 * Management", "Manager, Customer Success".
 */
export function roleName(title: string | null | undefined): string {
    const decoded = decodeText(title).trim();
    const parts = decoded.split(QUALIFIER_SPLIT).map((part) => part.trim()).filter(Boolean);
    const head = parts[0] || decoded;
    const words = head.split(/\s+/).filter(Boolean);
    let start = 0;
    let end = words.length;
    while (start < end && (rankWord(words[start]) || nonRoleWord(words[start]))) start += 1;
    while (end > start && (rankWord(words[end - 1]) || nonRoleWord(words[end - 1]))) end -= 1;
    const core = words.slice(start, end).join(" ");
    if (parts[1] && POST_FIRST.has(core.toLowerCase().replace(/\./g, ""))) return `${core}, ${parts[1]}`;
    return core || head;
}

function lower(value: string | null | undefined): string | null {
    const trimmed = (value ?? "").trim().toLowerCase();
    return trimmed ? trimmed : null;
}

function titleWords(title: string): string[] {
    return meaningfulTitleTokens(title).filter((word) => !RANK_WORDS.has(word) && !NON_ROLE_WORDS.has(word));
}

/** A posting's terms, as `RoleFeatures.terms`. */
export function roleTerms(job: PublicJob): string[] {
    const country = Array.isArray(job.location_country) ? job.location_country[0] : job.location_country;
    const places = locationWords(job);
    const terms = [
        ...titleWords(decodeText(job.title)).filter((word) => !places.has(word)).map((word) => `w:${word}`),
        ...(job.tags ?? []).map((tag) => lower(tag)).filter((tag): tag is string => tag != null && !NON_ROLE_WORDS.has(tag) && !places.has(tag)).map((tag) => `g:${tag}`),
        // Only skills read from a posting's own skills section (`evidencedSkills`).
        ...[...evidencedSkills(job, "must_have_skills"), ...(job.tech_stack ?? [])]
            .map((skill) => lower(skill))
            .filter(Boolean)
            .slice(0, 16)
            .map((skill) => `s:${skill}`),
        ...familiesNamedBy([job.title ?? ""]).map((family) => `f:${family}`),
        ...[
            ["c", job.company],
            ["l", job.experience_level],
            // The level its title names ("Senior", "Manager, …", "Intern"), which a listing often leaves "unknown".
            ["v", titleLevel(job.title)?.level ?? null],
            ["t", job.work_type],
            ["k", country],
            ["p", job.location_city],
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
const KIND_WEIGHT: Readonly<Record<string, number>> = { w: 1, g: 0.6, s: 0.5, c: 0.35, f: 0.3, l: 0.2, v: 0.2, t: 0.2, k: 0.2, p: 0.15 };

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

/** The terms that name a role: the words of its role name and its role families. */
function roleNamingTerms(role: string, terms: readonly string[]): Set<string> {
    return new Set([...titleWords(role).map((word) => `w:${word}`), ...terms.filter((term) => term.startsWith("f:"))]);
}

/**
 * What a nudge remembers about `job`. Given the deck it was seen in, `label` is
 * the term that most sets it apart from the other roles there (only terms some
 * other role shares, since only those steer the deck): its role when that is a
 * word of the role ("Product Manager" in a TAM's deck), else that word
 * ("Security"), its company or a skill.
 *
 * `own`: the role is the candidate's own kind of role. A thumbs-down or skip
 * on it is about this posting, not their line of work, so its label skips the
 * role's own words ("away from HashiCorp", not "away from Technical Account
 * Manager"), and is empty when nothing else sets it apart.
 */
export function roleFeatures(
    job: PublicJob,
    deck: readonly PublicJob[] = [],
    { own = false, signal, reason }: { own?: boolean; signal?: TuningSignal; reason?: TuningReason } = {},
): RoleFeatures {
    const role = roleName(job.title);
    const terms = roleTerms(job);
    if (reason) {
        const label = reasonLabel(job, role, terms, deck, reason);
        return own ? { role, label, terms, own } : { role, label, terms };
    }
    const ownDown = own && signal != null && SIGNAL_WEIGHT[signal] < 0;
    let label = ownDown ? "" : role;
    const others = deck.filter((other) => other.id !== job.id);
    if (others.length > 0) {
        const weight = deckTermWeights(others.map(roleTerms));
        const naming = roleNamingTerms(role, terms);
        const best = terms
            .filter((term) => /^[wcsg]:/.test(term) && weight(term) > 0 && !(ownDown && naming.has(term)))
            .sort((a, b) => weight(b) - weight(a))[0];
        if (best && !naming.has(best)) {
            const value = best.slice(2);
            label = best.startsWith("w:")
                ? titleCase(value, job.title ?? "")
                : best.startsWith("c:")
                  ? (job.company ?? value).trim()
                  : value;
        }
    }
    return own ? { role, label, terms, own } : { role, label, terms };
}

const LEVEL_WORDS: Readonly<Record<string, string>> = {
    intern: "intern",
    entry: "entry-level",
    mid: "mid-level",
    senior: "senior",
    lead: "lead",
    executive: "executive",
};

/** What the tuning line names for a nudge with a reason: "Acme", "senior roles", "remote roles", "Security". */
function reasonLabel(job: PublicJob, role: string, terms: readonly string[], deck: readonly PublicJob[], reason: TuningReason): string {
    switch (reason) {
        case "done":
            return "";
        case "role":
            return role;
        case "company":
            return decodeText(job.company ?? "").trim();
        case "level": {
            const level = terms.find((t) => t.startsWith("v:"))?.slice(2) ?? terms.find((t) => t.startsWith("l:"))?.slice(2);
            return level && LEVEL_WORDS[level] ? `${LEVEL_WORDS[level]} roles` : "";
        }
        case "place": {
            if (/remote/i.test(job.work_type ?? "")) return "remote roles";
            const city = decodeText(job.location_city ?? "").trim();
            const country = Array.isArray(job.location_country) ? job.location_country[0] : job.location_country;
            return city || (country ?? "").trim() || (/hybrid/i.test(job.work_type ?? "") ? "hybrid roles" : "");
        }
        case "field": {
            const naming = roleNamingTerms(role, terms);
            const others = deck.filter((other) => other.id !== job.id);
            const weight = others.length > 0 ? deckTermWeights(others.map(roleTerms)) : () => 1;
            const best = terms
                .filter((t) => /^[wgs]:/.test(t) && !naming.has(t))
                .sort((a, b) => weight(b) - weight(a))[0];
            if (!best) return "";
            return best.startsWith("w:") ? titleCase(best.slice(2), job.title ?? "") : best.slice(2);
        }
    }
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

/**
 * A thumbs-down or skip on one posting of the candidate's own kind of role is
 * about that posting, not their line of work. One "fewer" on a plain
 * "Technical Account Manager" in a TAM's deck used to move every TAM below
 * the roles around them. Now the words naming the role don't count for it;
 * what else set the posting apart does (its company, "Security"), and if
 * that is next to nothing (below `OWN_DOWN_MIN_WEIGHT`, squared weights as in
 * `similarity`) the nudge moves nothing. The posting itself still goes.
 */
export const OWN_DOWN_MIN_WEIGHT = 0.05;

const namingTermsOf = new WeakMap<RoleFeatures, Set<string>>();

/**
 * The term weights a nudge steers with: `weight`, or for a thumbs-down on the
 * candidate's own role, `weight` without the role's own words. Null when such
 * a nudge has too little else to steer by.
 */
function nudgeWeight(
    features: RoleFeatures,
    strength: number,
    weight: (term: string) => number,
    reason?: TuningReason,
): ((term: string) => number) | null {
    if (reason) return reasonWeight(features, reason, weight);
    if (!features.own || strength >= 0) return weight;
    let naming = namingTermsOf.get(features);
    if (!naming) {
        naming = roleNamingTerms(features.role, features.terms);
        namingTermsOf.set(features, naming);
    }
    const dropped = naming;
    const steering = (term: string) => (dropped.has(term) ? 0 : weight(term));
    const left = features.terms.reduce((sum, term) => sum + steering(term) ** 2, 0);
    return left < OWN_DOWN_MIN_WEIGHT ? null : steering;
}

/**
 * A nudge with a reason steers by that reason's terms only (`REASON_KINDS`),
 * each still weighed by how rare it is in the deck: "fewer — wrong level" on
 * a senior posting in a mostly mid-level deck moves the senior roles, and
 * nothing else about the posting (its company, its field) counts. Null when
 * the reason leaves nothing to steer by ("done", or a level no other role
 * differs on).
 */
function reasonWeight(features: RoleFeatures, reason: TuningReason, weight: (term: string) => number): ((term: string) => number) | null {
    const { kinds, words } = REASON_KINDS[reason];
    if (kinds.size === 0) return null;
    const naming = words ? roleNamingTerms(features.role, features.terms) : null;
    const steering = (term: string) => {
        const kind = term.slice(0, 1);
        if (!kinds.has(kind)) return 0;
        if (kind === "w" && naming) {
            const isNaming = naming.has(term);
            if (words === "naming" ? !isNaming : isNaming) return 0;
        }
        return weight(term);
    };
    const left = features.terms.reduce((sum, term) => sum + steering(term) ** 2, 0);
    return left > 0 ? steering : null;
}

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
        const steering = nudgeWeight(nudge.features, strength, weight, nudge.reason);
        if (!steering) continue;
        const alike = similarity(terms, nudge.features.terms, steering);
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
export const MAX_TUNING_SHIFT = 8;

export function maxShift(remaining: number): number {
    // A nudge, never a pin: "Tuned toward Customer Success Manager" filled a PM's deck with CSM
    // roles from a few saves and reads (2026-10-13). The résumé's order stays the backbone.
    return Math.min(MAX_TUNING_SHIFT, Math.max(1, remaining));
}

/**
 * Where a role sits before any tuning, for `tuneDeck`: `band` the group the list orders it in (age, reach, fit
 * band: `forYouSortKey(...).key`), `held` whether the résumé holds its title (its own role or the same kind of
 * work: `MatchScore.role` own or family). Built by `tuneRank` (band-order.ts).
 */
export interface TuneRank {
    band: number;
    held: boolean;
}

/**
 * `tuned` (the nudged order of `base`) kept to what a nudge may do: a role stays among the roles of its own
 * band, in that band's own places, and a title the résumé does not hold never passes one it does that led it.
 * So "fewer like this" on a Product Manager role reorders the Product Manager roles; it cannot put a SecOps
 * role above them, and "more like this" on a neighbour cannot lift it over the résumé's own role.
 */
function withinBands<T extends PublicJob>(base: readonly T[], tuned: readonly T[], rankOf: (job: T) => TuneRank | null): T[] {
    const rank = new Map<string, TuneRank>();
    const baseIndex = new Map<string, number>();
    const bands = new Map<number, T[]>();
    base.forEach((job, index) => {
        const r = rankOf(job) ?? { band: Number.POSITIVE_INFINITY, held: false };
        rank.set(job.id, r);
        baseIndex.set(job.id, index);
        const members = bands.get(r.band);
        if (members) members.push(job);
        else bands.set(r.band, [job]);
    });
    const out = new Array<T>(base.length);
    for (const [band, members] of bands) {
        const slots = members.map((job) => baseIndex.get(job.id)!);
        // The held roles that led each role the résumé does not hold: they stay ahead of it.
        const mustLead = new Map<string, string[]>();
        for (const job of members) {
            if (rank.get(job.id)!.held) continue;
            const here = baseIndex.get(job.id)!;
            mustLead.set(job.id, members.filter((other) => rank.get(other.id)!.held && baseIndex.get(other.id)! < here).map((other) => other.id));
        }
        const emitted = new Set<string>();
        const sequence: T[] = [];
        let waiting: T[] = [];
        const ready = (job: T) => (mustLead.get(job.id) ?? []).every((id) => emitted.has(id));
        const release = () => {
            for (let moved = true; moved; ) {
                moved = false;
                const next = waiting.find(ready);
                if (next) {
                    waiting = waiting.filter((job) => job !== next);
                    sequence.push(next);
                    emitted.add(next.id);
                    moved = true;
                }
            }
        };
        for (const job of tuned) {
            if (rank.get(job.id)?.band !== band) continue;
            if (rank.get(job.id)!.held || ready(job)) {
                sequence.push(job);
                emitted.add(job.id);
                release();
            } else waiting.push(job);
        }
        sequence.forEach((job, i) => (out[slots[i]] = job));
    }
    return out;
}

/**
 * The deck in the order to show it: the roles already reached (`passedIds`,
 * in that order), then the rest in their ranked order, each moved up or down
 * by its nudge. Returns `jobs` itself when nothing changes. With `rankOf`
 * (the deck and Today give it), a nudge keeps a role in its fit band and never
 * lifts a title the résumé does not hold over one it does (`withinBands`).
 */
export function tuneDeck<T extends PublicJob>(
    jobs: T[],
    nudges: readonly TuningNudge[],
    passedIds: readonly string[],
    nowMs: number,
    rankOf?: (job: T) => TuneRank | null,
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
    const nudgedOrder = keyed.map((entry) => entry.job);
    const tuned = rankOf ? withinBands(rest, nudgedOrder, rankOf) : nudgedOrder;
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

/** The visitor said why they tapped: the role's nudge now steers by that reason (`reasonWeight`). */
export function withReason(list: readonly TuningNudge[], jobId: string, reason: TuningReason, features?: RoleFeatures): TuningNudge[] {
    return list.map((item) => (item.jobId === jobId ? { ...item, reason, ...(features ? { features } : {}) } : item));
}

export function removeNudge(list: readonly TuningNudge[], jobId: string): TuningNudge[] {
    return list.filter((item) => item.jobId !== jobId);
}

/**
 * A nudge stored before `NON_ROLE_WORDS` existed, read as it would be recorded now: a work-mode, employment or region
 * word is no term of its role and no label ("away from Remote"). `load` in tuning-store.ts reads every stored nudge through this.
 */
export function sanitizeNudge(nudge: TuningNudge): TuningNudge {
    const { terms, label } = nudge.features;
    const kept = terms.filter((term) => !(/^[wg]:/.test(term) && NON_ROLE_WORDS.has(term.slice(2))));
    const named = NON_ROLE_WORDS.has(label.trim().toLowerCase()) ? "" : label;
    if (kept.length === terms.length && named === label) return nudge;
    return { ...nudge, features: { ...nudge.features, terms: kept, label: named } };
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
        if (!key || nudge.signal === "open" || nudge.signal === "dwell") continue;
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
