import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDescriptionHydration } from "../../src/lib/jobs/for-you/description-pane-state";
import type { PublicJob } from "../../src/lib/jobs/types";

function baseJob(overrides: Partial<PublicJob> = {}): PublicJob {
    return {
        id: "job-1",
        title: "Software Engineer",
        company: "Acme Corp",
        company_domain: "acme.example",
        location: "Remote",
        location_city: null,
        location_state: null,
        location_country: "US",
        work_type: "remote",
        description: null,
        employment_type: "full_time",
        experience_level: "mid",
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: [],
        apply_url: "https://acme.example/apply",
        source: "acme.example",
        posted_at: new Date().toISOString(),
        first_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        vacancy_status: "open",
        ghost_badge: "unscored",
        ...overrides,
    };
}

/**
 * Defect (live QA): ForYouDeck showed "No description available for this
 * role" for a card whose `hydratedJobs` fetch simply hadn't resolved yet —
 * or, for the second peeking neighbour, was never even dispatched (the
 * deck only prefetches the active pack + one lookahead). No map entry
 * collapsed to `descriptionPending: undefined`, which downstream readers
 * treated as "not pending" -> empty. Fixed by resolving hydration through
 * `resolveDescriptionHydration` first, which the new for-you surface calls
 * for EVERY rendered pack (active and prefetched lookahead) so "no entry
 * yet" and "entry mid-fetch" both read as pending, honestly, regardless of
 * position.
 */
describe("resolveDescriptionHydration", () => {
    it("no entry + description not yet loaded -> pending", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(pack, undefined);
        assert.equal(resolved.descriptionPending, true);
        assert.equal(resolved.job, pack);
    });

    it("no entry + description already loaded on the pack itself -> not pending, without waiting on a fetch", () => {
        const pack = baseJob({ description: "About the role:\n\nWe build tools." });
        const resolved = resolveDescriptionHydration(pack, undefined);
        assert.equal(resolved.descriptionPending, false);
        assert.equal(resolved.job, pack);
    });

    it("entry present and pending -> pending, regardless of the pack's own description", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(pack, { job: pack, descriptionPending: true });
        assert.equal(resolved.descriptionPending, true);
    });

    it("entry present and resolved with null (fetched, genuinely absent) -> not pending", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolvedJob = { ...pack, description: null };
        const resolved = resolveDescriptionHydration(pack, { job: resolvedJob, descriptionPending: false });
        assert.equal(resolved.descriptionPending, false);
        assert.equal(resolved.job.description, null);
    });

    it("a PEEKING (non-active) pack with no entry is pending too, not empty — the case beyond the one that surfaced the bug", () => {
        // The lookahead prefetch only dispatches for the active pack plus a
        // few ahead; a pack beyond that never gets a map entry at all.
        // resolveDescriptionHydration doesn't take an active/peeking flag —
        // that's the point: it must not special-case the active pack.
        const peekingPack = baseJob({ id: "job-2", description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(peekingPack, undefined);
        assert.equal(resolved.descriptionPending, true);
    });
});
