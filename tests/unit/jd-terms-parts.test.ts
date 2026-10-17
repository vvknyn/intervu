import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SEARCH_JD_READ_MAX_IDS, SEARCH_JD_READ_PART, withJdTerms } from "../../src/lib/jobs/jd-terms";
import type { JdTerms } from "../../src/lib/match/jd-match";
import type { PublicJob } from "../../src/lib/jobs/types";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: "Product Manager" }) as PublicJob);
const TERMS = { phrases: ["roadmap"] } as unknown as JdTerms;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A read that answers each part after `delays[part]` ms, recording the ids each part asked for. */
function reader(delays: number[]) {
    const parts: string[][] = [];
    const read = async (ids: string[]) => {
        const part = parts.push(ids) - 1;
        await sleep(delays[part] ?? 0);
        return Object.fromEntries(ids.map((id) => [id, TERMS]));
    };
    return { parts, read };
}

describe("withJdTerms reads a deep page in parts", () => {
    // 2026-10-17: a pack reads 300 rows. Its first 150 must get their terms as a page of 150 did, whatever the rest cost.
    it("reads 300 rows as two parts of 150, the second after the first", async () => {
        assert.equal(SEARCH_JD_READ_MAX_IDS, 300);
        assert.equal(SEARCH_JD_READ_PART, 150);
        const { parts, read } = reader([0, 0]);
        const out = await withJdTerms(rows(320), { read, deadlineMs: 200 });
        assert.deepEqual(parts.map((p) => p.length), [150, 150]);
        assert.equal(parts[0]![0], "r0");
        assert.equal(parts[1]![0], "r150");
        assert.equal(out.filter((r) => r.jd_terms).length, 300, "rows past the cap are not read");
    });

    it("keeps the first part's terms when the second misses its deadline", async () => {
        const { read } = reader([0, 500]);
        const out = await withJdTerms(rows(300), { read, deadlineMs: 100 });
        assert.equal(out.slice(0, 150).filter((r) => r.jd_terms).length, 150);
        assert.equal(out.slice(150).filter((r) => r.jd_terms !== undefined).length, 0, "the late part's rows come back as they were");
    });

    it("gives each part its own deadline, so two quick parts both land", async () => {
        const { read } = reader([70, 70]);
        const out = await withJdTerms(rows(300), { read, deadlineMs: 100 });
        assert.equal(out.filter((r) => r.jd_terms).length, 300);
    });

    it("does not read the next part once one misses its deadline", async () => {
        const { parts, read } = reader([500, 0]);
        const out = await withJdTerms(rows(300), { read, deadlineMs: 50 });
        assert.equal(parts.length, 1);
        assert.equal(out.filter((r) => r.jd_terms !== undefined).length, 0);
    });

    it("reads a page of 150 or fewer in one part, as before", async () => {
        const { parts, read } = reader([0]);
        await withJdTerms(rows(150), { read, deadlineMs: 100 });
        assert.deepEqual(parts.map((p) => p.length), [150]);
    });
});
