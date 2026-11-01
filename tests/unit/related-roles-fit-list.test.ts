/**
 * A list ranked by the person's résumé reads the typed title's postings only (2026-11-01, release 67 on prod: a TAM
 * résumé searching "product manager" led with Solutions Consultants, roles next to the title that fit the résumé
 * better than the title did). The roles next to a typed title stay in a search that is not ranked by a résumé.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTieredQuerySpecs } from "../../src/lib/jobs/meilisearch";
import type { JobSearchParams } from "../../src/lib/jobs/types";

const base = (extra: Partial<JobSearchParams> = {}): JobSearchParams => ({ q: "product manager", limit: 40, offset: 0, ...extra });
const tiers = (p: JobSearchParams) => buildTieredQuerySpecs(p).map((s) => s.tier);

describe("related roles in a résumé-ranked list", () => {
    it("a search that is not ranked by a résumé still has the related-role band (tier 3)", () => {
        assert.ok(tiers(base()).includes(3), "the typed title has neighbours in the table");
    });

    it("a list ranked by fit (fromResume) has the title's own tiers and no related-role band", () => {
        const t = tiers(base({ fromResume: true }));
        assert.ok(t.includes(1), "the typed title is still searched");
        assert.equal(t.includes(3), false, "no related-role query is sent");
    });

    it("the Best match preview ask finds nothing to read once a résumé ranks the list", () => {
        const specs = buildTieredQuerySpecs(base({ fromResume: true, relatedPreview: true }));
        assert.equal(specs.filter((s) => s.tier === 3).length, 0);
    });
});
