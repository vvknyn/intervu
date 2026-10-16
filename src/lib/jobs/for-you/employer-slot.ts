/**
 * One slot per employer in every list that recommends: the deck, Today, the daily picks (and their email) and the
 * MCP `for_you` and `daily_picks` tools. The list is first put in the one order (`forYouSortKey`, band-order.ts);
 * this is the last step on it. The first role of an employer is that employer's slot, so its place is its best
 * fit's, and the employer's other roles that made the list ride inside the slot (`more`, at most
 * `EMPLOYER_SLOT_OPENINGS` openings in all, the lead included) instead of taking a slot each. An employer with nine
 * openings no longer crowds out one with a single, better opening, and nothing is dropped silently: a slot says
 * how many openings it does not show (`hidden`) and the company's own page lists them.
 *
 * Search is not a recommendation: a person who types a title sees every role that has it, so Search never uses
 * this. The rule reads the roles alone, so it is the same for any role, industry and country.
 *
 * Pure, no I/O: the same isomorphic convention as band-order.ts.
 */
import { ATS_PORTAL_HOSTNAME_RE, displayCompanyName } from "@/lib/jobs/presentation";
import type { PublicJob } from "@/lib/jobs/types";

/** Openings one slot shows, the role that leads it included (the grouping size of a list that gives each employer a slot). */
export const EMPLOYER_SLOT_OPENINGS = 4;

export interface EmployerSlot<T> {
    /** The employer's best-placed role: the one the list shows. */
    lead: T;
    /** The employer's other roles in the list, in the list's order, at most `EMPLOYER_SLOT_OPENINGS - 1`. */
    more: T[];
    /** Roles of this employer in the list that the slot does not show (past the cap). */
    hidden: number;
}

/** The employer's own domain, lower-cased and bare, or `null` when the role has none or it is an ATS portal's (a tenant of a job board is not the employer). */
function domainKey(job: PublicJob): string | null {
    const raw = (job.company_domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
    if (!raw || ATS_PORTAL_HOSTNAME_RE.test(`.${raw}`)) return null;
    return raw;
}

/** The employer's name as the site shows it, lower-cased with its punctuation and legal form gone ("Acme, Inc." and "ACME inc" are one), or `null` when the role names none. */
function nameKey(job: PublicJob): string | null {
    const name = displayCompanyName(job.company).toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return name || null;
}

interface Group<T> {
    slot: EmployerSlot<T>;
    domain: string | null;
    names: Set<string>;
}

/**
 * `items` (already in the list's order) as one slot per employer, in the order of each employer's first role. Two
 * roles are one employer when they share a domain, or share a name and either has no domain to say otherwise
 * (two different domains under one name are two employers: a role never joins a slot on a name alone when both
 * sides name a domain). A role that names no employer is its own slot: nothing says whose it is.
 */
export function collapseByEmployer<T>(items: readonly T[], jobOf: (item: T) => PublicJob): EmployerSlot<T>[] {
    const groups: Group<T>[] = [];
    const byDomain = new Map<string, Group<T>>();
    const byName = new Map<string, Group<T>[]>();
    for (const item of items) {
        const job = jobOf(item);
        const domain = domainKey(job);
        const name = nameKey(job);
        let group = domain ? byDomain.get(domain) : undefined;
        if (!group && name) group = byName.get(name)?.find((g) => g.domain == null || domain == null || g.domain === domain);
        if (!group) {
            group = { slot: { lead: item, more: [], hidden: 0 }, domain, names: new Set() };
            groups.push(group);
        } else if (group.slot.more.length < EMPLOYER_SLOT_OPENINGS - 1) {
            group.slot.more.push(item);
        } else {
            group.slot.hidden++;
        }
        // A role that brings the domain a domain-less slot lacked gives it one; every name the slot is known by finds it.
        if (domain && group.domain == null) {
            group.domain = domain;
            byDomain.set(domain, group);
        } else if (domain && !byDomain.has(domain)) {
            byDomain.set(domain, group);
        }
        if (name && !group.names.has(name)) {
            group.names.add(name);
            byName.set(name, [...(byName.get(name) ?? []), group]);
        }
    }
    return groups.map((g) => g.slot);
}

/** The roles a list shows for `slots`: one per employer. */
export const slotLeads = <T>(slots: readonly EmployerSlot<T>[]): T[] => slots.map((slot) => slot.lead);

/** Every role a slot holds, shown or not: what a count of roles ("12 roles fit you at 7 employers") adds up. */
export const slotOpenings = <T>(slot: EmployerSlot<T>): number => 1 + slot.more.length + slot.hidden;
