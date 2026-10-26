/**
 * What a recommendation list says about the roles it left out, in the same words on every surface (the
 * For You deck's footer and empty state, the MCP `for_you` note): how many, and why, so a short list is
 * a count with a reason, never a list padded with roles that don't fit.
 */
import { PACK_MAX_AGE_DAYS, type DeckLeftOutSummary, type ListLeftOut } from "@/lib/jobs/for-you/band-order";
import { languageLabel } from "@/lib/match/posting-language";

const REASON_TEXT: Record<ListLeftOut, string> = {
    level: "above your level",
    requirement: "asking for something your résumé doesn't show",
    language: "written in another language",
    "other-role": "a different kind of role",
    stretch: "a weaker fit",
    abroad: "outside where you can work",
    unplaced: "not clear you can work there",
    old: `posted over ${PACK_MAX_AGE_DAYS} days ago`,
    closed: "with an apply link that no longer works",
    tracked: "already applied to",
};

/** Ties in count read in this order: the reasons about the person first. */
const REASON_ORDER: readonly ListLeftOut[] = ["level", "requirement", "language", "other-role", "stretch", "abroad", "unplaced", "old", "tracked", "closed"];

/** "8 written in French", largest first: roles left out for the language they are written in, by that language. */
export function writtenInParts(languages: Readonly<Record<string, number>>): string[] {
    return Object.entries(languages)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([language, count]) => `${count} written in ${languageLabel(language)}`);
}

/** The reasons with their counts, largest first; a posting left out for its language names it: "8 written in French". */
function leftOutCounted(summary: DeckLeftOutSummary): { n: number; text: string }[] {
    const parts: { n: number; text: string }[] = [];
    for (const reason of REASON_ORDER) {
        const n = summary.byReason[reason] ?? 0;
        if (n <= 0) continue;
        const written = reason === "language" ? Object.entries(summary.languages ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]) : [];
        if (written.length > 0) for (const [language, count] of written) parts.push({ n: count, text: writtenInParts({ [language]: count })[0]! });
        else parts.push({ n, text: `${n} ${REASON_TEXT[reason]}` });
    }
    return parts.sort((a, b) => b.n - a.n);
}

/** "41 above your level", largest first; a posting left out for its language names it: "8 written in French". */
export function leftOutParts(summary: DeckLeftOutSummary): string[] {
    return leftOutCounted(summary).map((part) => part.text);
}

/** What the line counts: all the roles the search found, or the first rows of them the list has read so far ("the first 150 of 226 roles found"). */
function readOfFound(summary: DeckLeftOutSummary): string {
    const read = summary.considered.toLocaleString();
    return summary.found != null && summary.found > summary.considered
        ? `the first ${read} of ${summary.found.toLocaleString()} roles found`
        : `the ${read} roles found`;
}

/** The roles left out and why, or null when the list left none out: the same words on the hub and at the foot of the deck. */
export function formatLeftOutLine(summary: DeckLeftOutSummary | null | undefined): string | null {
    if (!summary || summary.considered <= 0) return null;
    const counted = leftOutCounted(summary);
    if (counted.length === 0) return null;
    return `Left out of ${readOfFound(summary)}: ${counted.map((part) => part.text).join(" · ")}`;
}

/**
 * What a list holds: roles that fit, the closest when nothing fit (`near`), roles that fit and were posted over a month
 * ago because no newer one does (`older`), or the closest of those when not even a newer role is close (`older-near`).
 */
export type DeckListKind = "fit" | "near" | "older" | "older-near";

/** Which kind of list a summary describes (`deckListFor` marks the fallbacks with `near` and `older`; a list that read roles and listed none is the nothing-fits list with no closest roles to show). */
export function deckListKind(summary: Pick<DeckLeftOutSummary, "near" | "older" | "listed" | "considered"> | null | undefined): DeckListKind {
    const nothingFits = !!summary?.near || (summary != null && summary.listed === 0 && summary.considered > 0);
    if (nothingFits && summary?.older) return "older-near";
    if (nothingFits) return "near";
    if (summary?.older) return "older";
    return "fit";
}

/** " at 7 employers" when `roles` roles are spread over fewer employers, else nothing: the one clause every count of a list uses. */
function atEmployers(roles: number, employers?: number): string {
    const e = employers != null && Number.isFinite(employers) ? Math.floor(employers) : roles;
    return e > 0 && e < roles ? ` at ${e.toLocaleString()} ${e === 1 ? "employer" : "employers"}` : "";
}

/**
 * A list's count in the words the packs hub's chips, the deck's header, its foot and the hub's line all use: "12 roles at
 * 7 employers" when the deck gives each employer one card (`collapseByEmployer`) and some employer holds several roles,
 * else "7 roles". A count that names only one of the two would read as a different number from the other's.
 */
export function formatRolesAtEmployers(roles: number, employers?: number): string {
    const n = Math.floor(roles);
    return `${n.toLocaleString()} ${n === 1 ? "role" : "roles"}${atEmployers(n, employers)}`;
}

/**
 * The list's own count: "12 roles · ranked by fit", for every kind of list. It counts the roles the list leads with and the ones it ranks lower
 * (`rolesInList`), so it claims only what is true of all of them; what is true of the lead group alone ("the closest", "posted over 30 days ago") is
 * `listNoticeLine`'s, above that group. Its employers are the first row of the disclosure (`disclosureRows`).
 */
export function formatDeckShowingLine(listed: number): string | null {
    const n = Math.floor(listed);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${n.toLocaleString()} ${n === 1 ? "role" : "roles"} · ranked by fit`;
}

/**
 * The list's one count line (`formatDeckShowingLine`), counting every role the list shows (`rolesInList`), the ones ranked
 * lower included. A pack that read roles and shows none says so rather than showing no count; one that read nothing has no line.
 */
export function formatHubFitLine(summary: DeckLeftOutSummary | null | undefined): string | null {
    if (!summary) return null;
    if (rolesInList(summary) > 0) return formatDeckShowingLine(rolesInList(summary));
    return summary.considered > 0 ? "No role fits your résumé yet" : null;
}

/** Said above the closest roles, when nothing fit: a short list is an honest one, never padded with a fit it does not have. */
export const NEAR_MISS_NOTICE =
    "None of the roles we found fit your résumé well yet. These are the closest: your résumé shows little of what they ask for. Add detail to your résumé (what you did, the tools you used) for closer matches.";

/** Said above the older roles, when no role from the last month fits: they fit, but they may already be filled, and each card says how old it is. */
export const OLDER_FITS_NOTICE = `No role posted in the last ${PACK_MAX_AGE_DAYS} days fits your résumé yet. These fit, but they were posted longer ago and some may already be filled. Each card says how old it is.`;

/** Said above the closest older roles, when nothing newer is even close: a weaker fit, posted longer ago, and each card says how old it is. */
export const OLDER_NEAR_MISS_NOTICE = `None of the roles we found fit your résumé well yet, and nothing posted in the last ${PACK_MAX_AGE_DAYS} days is close. These are the closest, each a weaker fit, posted longer ago, and some may already be filled. Each card says how old it is.`;

const RESUME_ACTION = { label: "Résumé", href: "/resume" };

/**
 * The one quiet line the résumé-ranked list shows under its count, about the group it LEADS with only (the roles ranked lower
 * after it are not the closest, and not all old): the count above claims nothing the tail contradicts. The paragraph notices
 * above are for agent prose.
 */
export function listNoticeLine(kind: DeckListKind): { text: string; action?: { label: string; href: string } } | null {
    if (kind === "near") return { text: "None fit your résumé well yet: the roles at the top are the closest, each a weaker fit · add detail to your résumé for closer matches", action: RESUME_ACTION };
    if (kind === "older") return { text: `The roles at the top that fit were all posted over ${PACK_MAX_AGE_DAYS} days ago · some may already be filled, each card shows its age` };
    if (kind === "older-near") return { text: `Nothing posted in the last ${PACK_MAX_AGE_DAYS} days is close: the roles at the top are the closest, each a weaker fit and posted longer ago · some may already be filled · add detail to your résumé for closer matches`, action: RESUME_ACTION };
    return null;
}

/** The roles a list ranks lower, and the roles it leaves out (`byReason`'s rule cuts): the two counts the list's lines give. */
export const rankedLowerTotal = (summary: DeckLeftOutSummary): number => Object.values(summary.rankedLower ?? {}).reduce((sum, n) => sum + n, 0);
export const leftOutTotal = (summary: DeckLeftOutSummary): number => Object.values(summary.byReason).reduce((sum, n) => sum + n, 0);

/** Every role the list shows, cards and the roles folded behind "N more at X" alike: the ones it leads with plus the ones it ranks lower. The headline's number. */
export const rolesInList = (summary: DeckLeftOutSummary): number => summary.listed + rankedLowerTotal(summary);

/** "20 left out": the roles the list's rules cut, which the disclosure opens to explain. Null when none was cut. */
export function formatLeftOutCount(summary: DeckLeftOutSummary | null | undefined): string | null {
    const n = summary ? leftOutTotal(summary) : 0;
    return n > 0 ? `${n.toLocaleString()} left out` : null;
}

/** A plain search's roles past the person's level, left out of its list: the same "N left out" line and reason row as a ranked list's, with no action to bring them back. */
export function levelLeftOut(n: number): { line: string; rows: DisclosureRow[] } | null {
    if (!(n > 0)) return null;
    return { line: `${n.toLocaleString()} left out`, rows: [{ key: "level", group: "left-out", count: n, reason: REASON_TEXT.level }] };
}

/** What the disclosure's action does: widen the list to include the roles, or open the tracker. */
export type DisclosureAction = { kind: "include"; reason: ListLeftOut; language?: string } | { kind: "tracker" };

export interface DisclosureRow {
    key: string;
    group: "employers" | "left-out";
    /** Absent for the employers row, which is a sentence. */
    count?: number;
    reason: string;
    action?: DisclosureAction;
}

/** Hard cuts a person can bring back (`DeckListInclude`), and the one that goes to their tracker. */
const INCLUDABLE: ReadonlySet<ListLeftOut> = new Set(["old", "abroad", "unplaced"]);

/**
 * The expanded disclosure, one row per non-zero bucket: the list's employers, then what is left out (with the action that
 * brings it back). What is ranked lower has no row: the headline counts it and the list's divider marks it. `reason` is the same words as the old paragraph
 * (`REASON_TEXT`); a language is named ("written in German") and carries its own include action.
 */
export function disclosureRows(summary: DeckLeftOutSummary, employers?: number): DisclosureRow[] {
    const rows: DisclosureRow[] = [];
    const total = rolesInList(summary);
    const roles = formatRolesAtEmployers(total, employers);
    if (roles !== formatRolesAtEmployers(total)) rows.push({ key: "employers", group: "employers", reason: roles });
    const hardAction = (reason: ListLeftOut): DisclosureAction | undefined =>
        INCLUDABLE.has(reason) ? { kind: "include", reason } : reason === "tracked" ? { kind: "tracker" } : undefined;
    for (const reason of REASON_ORDER) {
        const n = summary.byReason[reason] ?? 0;
        if (n <= 0) continue;
        const written = reason === "language" ? Object.entries(summary.languages ?? {}).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]) : [];
        for (const [language, count] of written) rows.push({ key: `language-${language}`, group: "left-out", count, reason: `written in ${languageLabel(language)}`, action: { kind: "include", reason, language } });
        const rest = n - written.reduce((sum, [, count]) => sum + count, 0);
        if (rest > 0) rows.push({ key: reason, group: "left-out", count: rest, reason: REASON_TEXT[reason], action: reason === "language" ? undefined : hardAction(reason) });
    }
    return rows;
}
