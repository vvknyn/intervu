import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    selectTrackedCompanies,
    MAX_TRACKED_COMPANIES,
    type TrackedCompanyCandidate,
} from "@/lib/email/digest/tracked-companies";

const candidate = (domain: string | null, displayName: string | null = null): TrackedCompanyCandidate => ({
    domain,
    displayName,
});

describe("selectTrackedCompanies", () => {
    it("keeps a tracked company the reader does not follow", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate("stripe.com", "Stripe")],
            excludeDomains: [],
        });
        assert.deepEqual(picked, [{ domain: "stripe.com", displayName: "Stripe" }]);
    });

    // The reason `excludeDomains` exists. Following a company AND tracking a
    // role there is the common case, and without this the reader gets the
    // same roles twice under two headings — which reads as a broken email.
    it("drops a company the reader already follows, so no company appears twice", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate("stripe.com", "Stripe")],
            excludeDomains: ["stripe.com"],
        });
        assert.deepEqual(picked, []);
    });

    // The exclusion must use the SAME normalization `groupFollowAlertsByDomain`
    // applies to a hit's company_domain. If they disagree, an excluded domain
    // slips through here and the duplicate section comes back.
    it("matches the exclusion case- and whitespace-insensitively", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate("  STRIPE.com ", "Stripe")],
            excludeDomains: ["stripe.com"],
        });
        assert.deepEqual(picked, []);
    });

    it("collapses several pursuits at one company into a single entry", () => {
        const picked = selectTrackedCompanies({
            candidates: [
                candidate("stripe.com", "Stripe"),
                candidate("stripe.com", "Stripe"),
                candidate("STRIPE.COM", "Stripe"),
            ],
            excludeDomains: [],
        });
        assert.equal(picked.length, 1);
        assert.equal(picked[0]!.domain, "stripe.com");
    });

    // A pursuit with no job_id (an interview typed in by hand) resolves to no
    // listing and therefore no domain. It is skipped rather than guessed at:
    // matching its free-text company_name against indexed names is what made
    // `q=Harrods` return a venue's concession roles.
    it("skips a candidate with no domain instead of guessing one", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate(null, "Some Company Typed By Hand"), candidate("", "Blank"), candidate("  ")],
            excludeDomains: [],
        });
        assert.deepEqual(picked, []);
    });

    // Falls back through `displayCompany`, the same rule /jobs and /co
    // render with — so a nameless listing yields the humanized company
    // rather than a raw hostname in someone's inbox.
    it("derives a label from the domain when the listing carries no company name", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate("stripe.com", null), candidate("plaid.com", "   ")],
            excludeDomains: [],
        });
        assert.deepEqual(picked.map((p) => p.displayName), ["Stripe", "Plaid"]);
    });

    // The reason the fallback goes through `displayCompany` at all: a
    // listing's company field is external data and sometimes arrives as the
    // ATS portal hostname or a bare domain placeholder. Repairing it here
    // costs nothing; shipping it means an email headed "boards.greenhouse.io".
    it("repairs a company field that is really an ATS hostname", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate("stripe.com", "boards.greenhouse.io")],
            excludeDomains: [],
        });
        assert.doesNotMatch(picked[0]!.displayName, /greenhouse/i);
    });

    it("caps how many companies the lane contributes", () => {
        const many = Array.from({ length: MAX_TRACKED_COMPANIES + 5 }, (_, i) => candidate(`co-${i}.com`, `Co ${i}`));
        assert.equal(selectTrackedCompanies({ candidates: many, excludeDomains: [] }).length, MAX_TRACKED_COMPANIES);
    });

    // The cap counts what was KEPT, not what was examined — otherwise a run
    // of followed or unresolvable candidates at the front would silently eat
    // the budget and return fewer companies than the cap allows.
    it("spends the cap on kept companies, not on skipped candidates", () => {
        const picked = selectTrackedCompanies({
            candidates: [candidate(null), candidate("followed.com", "Followed"), candidate("kept.com", "Kept")],
            excludeDomains: ["followed.com"],
            cap: 1,
        });
        assert.deepEqual(picked, [{ domain: "kept.com", displayName: "Kept" }]);
    });
});
