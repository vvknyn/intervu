import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMAND_LIST_SIZE, normalizeDemandQuery, summarizeSearchDemand, type DemandRow } from "../../src/lib/admin/search-demand";
import { THIN_RESULTS_BELOW } from "../../src/lib/jobs/broaden";

const rows = (n: number, row: DemandRow): DemandRow[] => Array.from({ length: n }, () => ({ ...row }));

test("one spelling per query: case and spacing don't split a query's count", () => {
    assert.equal(normalizeDemandQuery("  Registered   Nurse "), "registered nurse");
    const demand = summarizeSearchDemand([{ q: "Nurse", resultCount: 50 }, { q: " nurse ", resultCount: 70 }], 30);
    assert.deepEqual(demand.popular, [{ query: "nurse", searches: 2, typicalResults: 60 }]);
});

test("a query lands in Nothing found or Under 30 by what its typical search found", () => {
    const demand = summarizeSearchDemand(
        [
            ...rows(3, { q: "underwater welder", resultCount: 0 }),
            ...rows(2, { q: "sommelier", resultCount: 4 }),
            { q: "sommelier", resultCount: 0 },
            ...rows(5, { q: "nurse", resultCount: 400 }),
        ],
        30,
    );
    assert.deepEqual(demand.nothingFound.map((q) => q.query), ["underwater welder"]);
    assert.deepEqual(demand.fewFound.map((q) => [q.query, q.typicalResults]), [["sommelier", 4]]);
    assert.equal(demand.popular[0].query, "nurse");
    assert.equal(demand.thinBelow, THIN_RESULTS_BELOW);
});

test("failed searches are counted apart and never read as nothing found", () => {
    const demand = summarizeSearchDemand(
        [{ q: "nurse", resultCount: 0, unavailable: true }, { q: "nurse", resultCount: 0 }, { q: "teacher", resultCount: 100 }],
        30,
    );
    assert.equal(demand.searches, 3);
    assert.equal(demand.failed, 1);
    assert.equal(demand.noneShare, 50);
    assert.deepEqual(demand.nothingFound, [{ query: "nurse", searches: 1, typicalResults: 0 }]);
});

test("places: the place picked, else the visitor's country; places with no roles listed apart", () => {
    const demand = summarizeSearchDemand(
        [
            { q: "nurse", resultCount: 3, places: ["Calgary"] },
            { q: "nurse", resultCount: 300, places: ["calgary"] },
            { q: "nurse", resultCount: 300, defaultedCountry: "CA" },
            { q: "nurse", resultCount: 0, unmatchedPlaces: ["Red Deer County"] },
        ],
        30,
    );
    assert.deepEqual(demand.places[0], { label: "Calgary", searches: 2, fewOrNone: 1 });
    assert.deepEqual(demand.places[1], { label: "CA", searches: 1, fewOrNone: 0 });
    assert.deepEqual(demand.missingPlaces, [{ label: "Red Deer County", searches: 1, fewOrNone: 1 }]);
});

test("companies: an employer named with nothing open, or a company search that came back thin", () => {
    const demand = summarizeSearchDemand(
        [
            ...rows(2, { q: "alberta health services", resultCount: 120, missedCompanies: ["albertahealthservices.ca"] }),
            { q: "", resultCount: 2, company: "ellisdon.com" },
            { q: "", resultCount: 200, company: "shopify.com" },
        ],
        30,
    );
    assert.deepEqual(
        demand.companies.map((c) => [c.label, c.searches]),
        [["albertahealthservices.ca", 2], ["ellisdon.com", 1]],
    );
});

test("each list is capped and nothing in the summary names a person", () => {
    const many = Array.from({ length: DEMAND_LIST_SIZE + 10 }, (_, i) => ({ q: `role ${i}`, resultCount: 0 }));
    const demand = summarizeSearchDemand(many, 30);
    assert.equal(demand.popular.length, DEMAND_LIST_SIZE);
    assert.equal(demand.nothingFound.length, DEMAND_LIST_SIZE);
    const keys = JSON.stringify(demand);
    for (const k of ["uid", "userId", "user_id", "ip", "email", "visitor"]) assert.equal(keys.includes(`"${k}"`), false);
});
