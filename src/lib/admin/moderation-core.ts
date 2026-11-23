/**
 * The rules of admin moderation, with its collaborators injected so they can be
 * tested without a session or a Subspace: who may ask (the server-side admin
 * check, run on EVERY call), what is validated before Subspace is contacted, and
 * how Subspace's answer is turned into a result the UI renders. The "use server"
 * file (src/actions/admin-moderation.ts) wires the real session and the real
 * Subspace client in; nothing here imports either.
 */
import {
    DOMAIN_REASONS,
    LISTING_REASONS,
    NOTE_MAX,
    cleanDomainInput,
    parseListingRef,
    type DomainPreview,
    type DomainRejected,
    type ListingPreview,
    type ListingRemoved,
    type ModerationLogRow,
} from "@/lib/admin/moderation";
import type { ModerationResult } from "@/lib/jobs/subspace-moderation";

export type ModerationActionResult<T> =
    | { kind: "ok"; data: T }
    | { kind: "forbidden" }
    | { kind: "unavailable" }
    | { kind: "error"; message: string; code: string };

export type Gate = { ok: true; actor: string } | { ok: false };

export interface ModerationDeps {
    /** Is the caller a signed-in admin? Asked on every call. */
    requireAdmin(): Promise<Gate>;
    /** Is a Subspace moderation key configured on this server? */
    configured(): boolean;
    post<T>(body: Record<string, unknown> & { action: string }): Promise<ModerationResult<T>>;
    log<T>(limit: number): Promise<ModerationResult<T>>;
}

function settle<T>(res: ModerationResult<T>): ModerationActionResult<T> {
    if (res.ok) return { kind: "ok", data: res.data };
    if (res.code === "unavailable") return { kind: "unavailable" };
    return { kind: "error", message: res.message, code: res.code };
}

const invalid = (message: string): ModerationActionResult<never> => ({ kind: "error", message, code: "invalid_input" });
const note = (raw: unknown) => (typeof raw === "string" && raw.trim() ? raw.trim().slice(0, NOTE_MAX) : undefined);

export function createModeration(deps: ModerationDeps) {
    return {
        /** Should the admin controls render at all? Admin and configured. Never reveals which half failed. */
        async available(): Promise<boolean> {
            if (!deps.configured()) return false;
            return (await deps.requireAdmin()).ok;
        },

        /** Look a listing up from a pasted link or id; nothing is changed. */
        async previewListing(ref: string): Promise<ModerationActionResult<ListingPreview>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            const listingId = parseListingRef(typeof ref === "string" ? ref : "");
            if (!listingId) return invalid("That doesn't contain a listing id. Paste the job link or its id.");
            return settle(await deps.post<ListingPreview>({ action: "close_listing", actor: gate.actor, listing_id: listingId, reason: "other", dry_run: true }));
        },

        async removeListing(input: { jobId: string; reason: string; note?: string }): Promise<ModerationActionResult<ListingRemoved>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            const listingId = parseListingRef(typeof input?.jobId === "string" ? input.jobId : "");
            if (!listingId) return invalid("That isn't a listing id.");
            if (!LISTING_REASONS.includes(input.reason)) return invalid("Pick a reason.");
            return settle(await deps.post<ListingRemoved>({ action: "close_listing", actor: gate.actor, listing_id: listingId, reason: input.reason, note: note(input.note) }));
        },

        /** The counted plan for marking a domain: the board, how many listings are open, a sample. Changes nothing. */
        async previewDomain(input: { domain: string; reason: string }): Promise<ModerationActionResult<DomainPreview>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            const domain = cleanDomainInput(typeof input?.domain === "string" ? input.domain : "");
            if (!domain) return invalid("Enter a domain, like example.com.");
            if (!DOMAIN_REASONS.includes(input.reason)) return invalid("Pick a reason.");
            return settle(await deps.post<DomainPreview>({ action: "reject_domain", actor: gate.actor, domain, reason: input.reason, dry_run: true }));
        },

        /** Apply the plan the preview showed. `expectOpenListings` is that preview's count; Subspace refuses if it has moved far. */
        async rejectDomain(input: { domain: string; reason: string; note?: string; expectOpenListings: number }): Promise<ModerationActionResult<DomainRejected>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            const domain = cleanDomainInput(typeof input?.domain === "string" ? input.domain : "");
            if (!domain) return invalid("Enter a domain, like example.com.");
            if (!DOMAIN_REASONS.includes(input.reason)) return invalid("Pick a reason.");
            if (!Number.isInteger(input.expectOpenListings) || input.expectOpenListings < 0) return invalid("Preview the domain first.");
            return settle(
                await deps.post<DomainRejected>({
                    action: "reject_domain",
                    actor: gate.actor,
                    domain,
                    reason: input.reason,
                    note: note(input.note),
                    expect_open_listings: input.expectOpenListings,
                }),
            );
        },

        /** Undo one logged action by its log id. */
        async undo(input: { logId: number; kind: "close_listing" | "reject_domain" }): Promise<ModerationActionResult<{ log_id: number; note?: string }>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            if (!Number.isSafeInteger(input?.logId) || input.logId <= 0) return invalid("That isn't a log entry.");
            const action = input.kind === "close_listing" ? "restore_listing" : input.kind === "reject_domain" ? "restore_domain" : null;
            if (!action) return invalid("That action can't be undone.");
            return settle(await deps.post<{ log_id: number; note?: string }>({ action, actor: gate.actor, log_id: input.logId }));
        },

        async list(): Promise<ModerationActionResult<ModerationLogRow[]>> {
            const gate = await deps.requireAdmin();
            if (!gate.ok) return { kind: "forbidden" };
            return settle(await deps.log<ModerationLogRow[]>(50));
        },
    };
}
