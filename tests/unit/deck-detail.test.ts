import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deckFactParts, deckOverlapSentence, deckRelistedWord } from "../../src/lib/jobs/for-you/deck-detail";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";

function job(partial: Partial<PublicJob> & Pick<PublicJob, "id" | "title">): PublicJob {
    return {
        id: partial.id,
        title: partial.title,
        company: partial.company ?? "Acme",
        company_domain: null,
        location: partial.location ?? "Austin, TX",
        location_city: partial.location_city ?? "Austin",
        location_state: partial.location_state ?? "TX",
        location_country: partial.location_country ?? "United States",
        work_type: partial.work_type ?? "remote",
        description: partial.description ?? null,
        employment_type: partial.employment_type ?? "full_time",
        experience_level: partial.experience_level ?? "senior",
        salary_min: partial.salary_min ?? 160000,
        salary_max: partial.salary_max ?? 180000,
        salary_currency: "USD",
        salary_period: "year",
        visa_sponsorship: null,
        tags: [],
        occupation: null,
        apply_url: "https://example.com/apply",
        source: "test",
        posted_at: partial.posted_at ?? null,
        first_seen_at: partial.first_seen_at ?? null,
        posted_ts: null,
        updated_at: null,
        vacancy_status: "open",
        ghost_badge: partial.ghost_badge ?? "clear",
    };
}

describe("deck detail copy", () => {
    it("names a real title overlap and skips term-count or country", () => {
        const resume = {
            profile: { profession: "Senior Digital Product Manager" },
            experience: [{ role: "Senior Digital Product Manager" }],
        } as ResumeData;
        const sentence = deckOverlapSentence(
            job({ id: "1", title: "Digital Product Manager" }),
            resume,
        );
        assert.equal(sentence, "Overlaps your Senior Digital Product Manager experience.");
        assert.equal(
            deckOverlapSentence(job({ id: "2", title: "Account Executive" }), resume),
            null,
        );
    });

    it("keeps facts in one list and relist as one word", () => {
        const role = job({ id: "1", title: "Digital Product Manager", work_type: "remote" });
        const parts = deckFactParts(role, "3d ago");
        assert.ok(parts.some((part) => /austin/i.test(part)));
        assert.ok(parts.includes("Remote"));
        assert.ok(parts.includes("Posted 3d ago"));
        assert.equal(parts.some((part) => /relist/i.test(part)), false);
        assert.equal(deckRelistedWord(role, Date.now()), null);
    });
});
