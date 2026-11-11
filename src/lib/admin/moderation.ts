/**
 * Admin moderation, the parts that need no server: the reason lists the forms
 * show, and the two input cleaners. Safe to import from a client component.
 *
 * What moderation is: an admin removes ONE listing (a classifieds ad filed as a
 * job, spam, the wrong company) or marks ONE domain as not an employer (a
 * marketplace or aggregator bound as an employer board). Both are soft. Subspace
 * owns the verdicts and the validation (src/lib/admin-moderation/contract.ts
 * there); the lists below must match its `LISTING_REASONS` / `DOMAIN_REASONS`
 * and are pinned against them by tests/unit/admin-moderation.test.ts.
 */

export const LISTING_REASON_OPTIONS = [
    { value: "not_a_job", label: "Not a job (an ad, a for-sale post)" },
    { value: "wrong_company", label: "Filed under the wrong company" },
    { value: "spam", label: "Spam" },
    { value: "duplicate", label: "Duplicate" },
    { value: "other", label: "Something else" },
] as const;
export type ListingReason = (typeof LISTING_REASON_OPTIONS)[number]["value"];

export const DOMAIN_REASON_OPTIONS = [
    { value: "classifieds_or_marketplace", label: "Classifieds or marketplace" },
    { value: "aggregator", label: "Job aggregator" },
    { value: "job_board", label: "Job board" },
    { value: "staffing_agency", label: "Staffing agency" },
    { value: "not_an_employer", label: "Not an employer" },
    { value: "other", label: "Something else" },
] as const;
export type DomainReason = (typeof DOMAIN_REASON_OPTIONS)[number]["value"];

export const LISTING_REASONS: readonly string[] = LISTING_REASON_OPTIONS.map((o) => o.value);
export const DOMAIN_REASONS: readonly string[] = DOMAIN_REASON_OPTIONS.map((o) => o.value);

export const NOTE_MAX = 500;

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * A listing id from whatever the admin pasted: the bare uuid, or a Velai job
 * link (`/jobs/<slug>-<uuid>`, see jobPath). The LAST uuid wins, because the
 * trailing one is authoritative and the slug is decorative.
 */
export function parseListingRef(raw: string): string | null {
    const all = raw.match(UUID_ANYWHERE);
    return all && all.length > 0 ? all[all.length - 1].toLowerCase() : null;
}

/**
 * A bare host from what the admin typed or pasted: scheme, path, `www.` and a
 * trailing dot stripped, lowercased. Only a courtesy to the form; Subspace
 * re-validates with the same canonicalisation every board writer uses.
 */
export function cleanDomainInput(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/[/?#].*$/, "")
        .replace(/^www\./, "")
        .replace(/\.+$/, "");
}

/** What a preview of one listing returns (a subset of Subspace's response). */
export interface ListingPreview {
    dry_run: true;
    already_removed: boolean;
    listing: {
        id: string;
        title: string | null;
        company: string | null;
        company_domain: string | null;
        url: string | null;
        vacancy_status: string | null;
        is_hidden: boolean;
        hidden_reason: string | null;
    };
}

export interface DomainPreview {
    dry_run: true;
    domain: string;
    board: { exists: boolean; status: string | null; company_name: string | null };
    already_rejected: boolean;
    open_listings: number;
    sample: Array<{ id: string; title: string | null; url: string | null }>;
}

export interface ListingRemoved {
    already_removed: boolean;
    log_id: number | null;
    note?: string;
}

export interface DomainRejected {
    domain: string;
    board_status: string;
    closed: number;
    remaining_open_listings: number;
    log_id: number;
    note?: string;
}

export interface ModerationLogRow {
    id: number;
    created_at: string;
    actor: string;
    action: "close_listing" | "restore_listing" | "reject_domain" | "restore_domain";
    target: string;
    reason: string;
    note: string | null;
    affected: number;
    undone_at: string | null;
    undone_by: string | null;
}
