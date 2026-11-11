"use server";

/**
 * Admin moderation: remove one listing, or mark one domain as not an employer.
 *
 * Both are soft and reversible, and both are carried out by Subspace
 * (src/lib/jobs/subspace-moderation.ts). This file only wires the real session
 * and the real Subspace client into the rules in src/lib/admin/moderation-core.ts.
 * Admin is the same test /admin and the credit gate use, `isAdminUser`: the
 * ADMIN_EMAILS allowlist (default vivek.nar87@gmail.com) or profiles.is_admin. It
 * runs on every call, on the server; a hidden button is a courtesy and never the
 * gate. A non-admin gets `forbidden` and Subspace is never contacted. The asking
 * admin's email (or uid) is sent as `actor` and logged by Subspace.
 */

import { getServerUser } from "@/lib/auth/server-user";
import { isAdminUser } from "@/lib/llm/credit-gate";
import { createModeration, type ModerationActionResult } from "@/lib/admin/moderation-core";
import { getModerationLog, hasModerationKey, postModeration } from "@/lib/jobs/subspace-moderation";
import type { DomainPreview, DomainRejected, ListingPreview, ListingRemoved, ModerationLogRow } from "@/lib/admin/moderation";

export type { ModerationActionResult };

const moderation = createModeration({
    async requireAdmin() {
        const user = await getServerUser();
        if (!user || !(await isAdminUser(user))) return { ok: false };
        return { ok: true, actor: user.email ?? user.uid };
    },
    configured: hasModerationKey,
    post: postModeration,
    log: getModerationLog,
});

export async function adminModerationAvailableAction(): Promise<boolean> {
    return moderation.available();
}

export async function previewListingAction(ref: string): Promise<ModerationActionResult<ListingPreview>> {
    return moderation.previewListing(ref);
}

export async function removeListingAction(input: { jobId: string; reason: string; note?: string }): Promise<ModerationActionResult<ListingRemoved>> {
    return moderation.removeListing(input);
}

export async function previewDomainAction(input: { domain: string; reason: string }): Promise<ModerationActionResult<DomainPreview>> {
    return moderation.previewDomain(input);
}

export async function rejectDomainAction(input: { domain: string; reason: string; note?: string; expectOpenListings: number }): Promise<ModerationActionResult<DomainRejected>> {
    return moderation.rejectDomain(input);
}

export async function undoModerationAction(input: { logId: number; kind: "close_listing" | "reject_domain" }): Promise<ModerationActionResult<{ log_id: number; note?: string }>> {
    return moderation.undo(input);
}

export async function listModerationLogAction(): Promise<ModerationActionResult<ModerationLogRow[]>> {
    return moderation.list();
}
