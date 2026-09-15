import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    descriptionPaneState,
    resolveDescriptionHydration,
} from "../../src/lib/jobs/for-you/description-pane-state";
import { splitPackSections } from "../../src/lib/jobs/for-you/pack-sections";
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
 * Defect (live QA): ForYouPack flashed "No description available for this
 * role" for a job that HAS a description, because pendingness was inferred
 * from `displayJob.description === undefined` instead of the pending flag —
 * a fetch resolving to a transient empty string while still in flight fell
 * straight through to the empty state. Fixed by deciding pane state from
 * `descriptionPending` alone.
 */
describe("descriptionPaneState", () => {
    it("shows loading while pending, even though the not-yet-arrived description is an empty string (the surfaced bug)", () => {
        const sections = splitPackSections("");
        assert.equal(descriptionPaneState(true, sections), "loading");
    });

    it("shows loading while pending for any other falsy description shape (class-wide, not just empty string)", () => {
        assert.equal(descriptionPaneState(true, splitPackSections(null)), "loading");
        assert.equal(descriptionPaneState(true, splitPackSections(undefined)), "loading");
    });

    it("shows empty once genuinely finished with nothing to show, never fabricating content", () => {
        const sections = splitPackSections("");
        assert.equal(descriptionPaneState(false, sections), "empty");
    });

    it("shows content once genuinely finished with real sections", () => {
        const sections = splitPackSections("About the role:\n\nWe build tools.");
        assert.equal(descriptionPaneState(false, sections), "content");
    });
});

/**
 * Defect (live QA): ForYouDeck showed "No description available for this
 * role" for a card whose `hydratedJobs` fetch simply hadn't resolved yet —
 * or, for the second peeking neighbour, was never even dispatched (the
 * deck only prefetches the active pack + one lookahead). No map entry
 * collapsed to `descriptionPending: undefined`, which `descriptionPaneState`
 * reads as "not pending" -> empty sections -> "empty". Fixed by resolving
 * hydration through `resolveDescriptionHydration` first, which the deck now
 * calls for EVERY rendered pack (active and both peeking neighbours) so
 * "no entry yet" and "entry mid-fetch" both read as pending, honestly,
 * regardless of active/peeking position.
 */
describe("resolveDescriptionHydration", () => {
    it("no entry + description not yet loaded -> pending (loading)", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(pack, undefined);
        assert.equal(resolved.descriptionPending, true);
        assert.equal(descriptionPaneState(resolved.descriptionPending, splitPackSections(resolved.job.description)), "loading");
    });

    it("no entry + description already loaded on the pack itself -> content, without waiting on a fetch", () => {
        const pack = baseJob({ description: "About the role:\n\nWe build tools." });
        const resolved = resolveDescriptionHydration(pack, undefined);
        assert.equal(resolved.descriptionPending, false);
        assert.equal(descriptionPaneState(resolved.descriptionPending, splitPackSections(resolved.job.description)), "content");
    });

    it("entry present and pending -> loading, regardless of the pack's own description", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(pack, { job: pack, descriptionPending: true });
        assert.equal(resolved.descriptionPending, true);
        assert.equal(descriptionPaneState(resolved.descriptionPending, splitPackSections(resolved.job.description)), "loading");
    });

    it("entry present and resolved with null (fetched, genuinely absent) -> empty", () => {
        const pack = baseJob({ description: undefined as unknown as string | null });
        const resolvedJob = { ...pack, description: null };
        const resolved = resolveDescriptionHydration(pack, { job: resolvedJob, descriptionPending: false });
        assert.equal(resolved.descriptionPending, false);
        assert.equal(descriptionPaneState(resolved.descriptionPending, splitPackSections(resolved.job.description)), "empty");
    });

    it("a PEEKING (non-active) pack with no entry is pending too, not empty — the case beyond the one that surfaced the bug", () => {
        // ForYouDeck only dispatches a fetch for the active pack and one
        // lookahead; a second peeking neighbour never gets a map entry at
        // all. resolveDescriptionHydration doesn't take an active/peeking
        // flag — that's the point: it must not special-case the active pack.
        const peekingPack = baseJob({ id: "job-2", description: undefined as unknown as string | null });
        const resolved = resolveDescriptionHydration(peekingPack, undefined);
        assert.equal(resolved.descriptionPending, true);
        assert.equal(descriptionPaneState(resolved.descriptionPending, splitPackSections(resolved.job.description)), "loading");
    });
});
