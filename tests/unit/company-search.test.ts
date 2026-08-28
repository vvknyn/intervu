import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import { normalizeCompanySearchQuery, searchCompanies } from "../../src/lib/companies/company-search";
import type { Queryable } from "../../src/lib/pg/pool";

function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("normalizeCompanySearchQuery", () => {
    it("trims and lowercases for a plain substring check", () => {
        assert.equal(normalizeCompanySearchQuery("  Stripe  "), "stripe");
    });

    it("does not escape anything — there is no SQL pattern to protect", () => {
        // Unlike the retired ILIKE-pattern version, wildcard-looking
        // characters pass through untouched: the only consumer is `.includes()`.
        assert.equal(normalizeCompanySearchQuery("100%_done\\x"), "100%_done\\x");
    });
});

/** Records the query text/params it received and returns fixed rows — good
 *  enough to prove the batched extras read's SQL shape without a live
 *  Postgres connection. */
function fakePg(rows: Array<{ company_domain: string; payload: Record<string, unknown> }>): {
    pg: Queryable;
    calls: Array<{ text: string; params: unknown[] }>;
} {
    const calls: Array<{ text: string; params: unknown[] }> = [];
    return {
        calls,
        pg: {
            async query<R>(text: string, params: unknown[] = []) {
                calls.push({ text, params });
                return { rows: rows as unknown as R[] };
            },
        },
    };
}

describe("searchCompanies", () => {
    let originalHost: string | undefined;
    let originalKey: string | undefined;

    before(() => {
        originalHost = process.env.MEILISEARCH_HOST;
        originalKey = process.env.MEILISEARCH_SEARCH_KEY;
        process.env.MEILISEARCH_HOST = "https://meili.test";
        process.env.MEILISEARCH_SEARCH_KEY = "k";
    });

    after(() => {
        if (originalHost === undefined) delete process.env.MEILISEARCH_HOST;
        else process.env.MEILISEARCH_HOST = originalHost;
        if (originalKey === undefined) delete process.env.MEILISEARCH_SEARCH_KEY;
        else process.env.MEILISEARCH_SEARCH_KEY = originalKey;
    });

    afterEach(() => {
        mock.reset();
    });

    it("scopes the Meili query to the company field and over-fetches by the limit multiplier", async () => {
        const fetchMock = mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [] }));
        const { pg } = fakePg([]);
        await searchCompanies(pg, "acme", 5);

        assert.equal(fetchMock.mock.calls.length, 1);
        const [url, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
        assert.match(url, /\/indexes\/jobs\/search$/);
        const body = JSON.parse(String(init.body));
        assert.deepEqual(body.attributesToSearchOn, ["company"]);
        assert.equal(body.q, "acme");
        assert.equal(body.limit, 50); // 5 * MEILI_OVERFETCH_MULTIPLIER
    });

    it("dedupes hits by company_domain, preserving Meili rank order, and cuts to limit", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, {
                hits: [
                    { company: "Acme Corp", company_domain: "acme.com" },
                    { company: "Acme Corp (dup posting)", company_domain: "acme.com" },
                    { company: "Acme Robotics", company_domain: "acmerobotics.com" },
                    { company: "Acme Widgets", company_domain: "acmewidgets.com" },
                ],
            }),
        );
        const { pg } = fakePg([]);
        const hits = await searchCompanies(pg, "acme", 2);
        assert.deepEqual(hits.map((h) => h.domain), ["acme.com", "acmerobotics.com"]);
    });

    it("post-filters out hits whose company/domain do not actually contain the query substring", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, {
                hits: [
                    { company: "Acme Corp", company_domain: "acme.com" },
                    { company: "Globex", company_domain: "globex.com" },
                ],
            }),
        );
        const { pg } = fakePg([]);
        const hits = await searchCompanies(pg, "acme", 20);
        assert.deepEqual(hits.map((h) => h.domain), ["acme.com"]);
    });

    it("matches on company_domain when the query does not appear in the company name", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, { hits: [{ company: "Widget Inc", company_domain: "acme-widgets.io" }] }),
        );
        const { pg } = fakePg([]);
        const hits = await searchCompanies(pg, "acme", 20);
        assert.deepEqual(hits.map((h) => h.domain), ["acme-widgets.io"]);
    });

    it("reads the extras in one batched, parameterized query keyed by the matched domains", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, { hits: [{ company: "Acme Corp", company_domain: "acme.com" }] }),
        );
        const { pg, calls } = fakePg([
            { company_domain: "acme.com", payload: { industries: ["software"], hq_country: "US", total_jobs: 12 } },
        ]);
        const [hit] = await searchCompanies(pg, "acme", 20);

        assert.equal(calls.length, 1);
        assert.match(calls[0].text, /data_type = 'company_profile'/);
        assert.match(calls[0].text, /company_domain = ANY\(\$1\)/);
        assert.deepEqual(calls[0].params[0], ["acme.com"]);
        assert.deepEqual(hit, { domain: "acme.com", name: "Acme Corp", industries: ["software"], hqCountry: "US", openRolesHint: 12 });
    });

    it("returns bare Meili results with honest null extras when pg is unavailable, instead of losing the search", async () => {
        mock.method(globalThis, "fetch", async () =>
            jsonResponse(200, { hits: [{ company: "Acme Corp", company_domain: "acme.com" }] }),
        );
        const [hit] = await searchCompanies(null, "acme", 20);
        assert.deepEqual(hit, { domain: "acme.com", name: "Acme Corp", industries: [], hqCountry: null, openRolesHint: null });
    });

    it("falls back to the domain as name when Meili has no company text and enrichment has none either", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [{ company: null, company_domain: "noname.io" }] }));
        const { pg } = fakePg([{ company_domain: "noname.io", payload: {} }]);
        const [hit] = await searchCompanies(pg, "noname", 20);
        assert.equal(hit.name, "noname.io");
    });

    it("propagates a Meili failure as a thrown error rather than falling back to Postgres or returning an empty list", async () => {
        mock.method(globalThis, "fetch", async () => jsonResponse(500, { message: "down" }));
        const { pg, calls } = fakePg([]);
        await assert.rejects(() => searchCompanies(pg, "acme", 20));
        assert.equal(calls.length, 0);
    });

    it("returns empty when Meilisearch is not configured, without attempting a Postgres read or a network call", async () => {
        const fetchMock = mock.method(globalThis, "fetch", async () => jsonResponse(200, { hits: [] }));
        const prevHost = process.env.MEILISEARCH_HOST;
        delete process.env.MEILISEARCH_HOST;
        try {
            const { pg, calls } = fakePg([]);
            const hits = await searchCompanies(pg, "acme", 20);
            assert.deepEqual(hits, []);
            assert.equal(calls.length, 0);
            assert.equal(fetchMock.mock.calls.length, 0);
        } finally {
            if (prevHost !== undefined) process.env.MEILISEARCH_HOST = prevHost;
        }
    });
});
