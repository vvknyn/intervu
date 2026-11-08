import { test } from "node:test";
import assert from "node:assert/strict";
import {
    chosenEmployerRole,
    employerFallbackWindow,
    employerNameFromHits,
    joinEmployerFallback,
    pinToEmployer,
    withoutEmployer,
} from "../../src/lib/jobs/employer-role";
import { employerReadNote, employerRoleNote } from "../../src/lib/jobs/result-state";
import { mergeUnderstood, withEmployerUnderstood } from "../../src/lib/jobs/understood";
import { pageRowsInListOrder } from "../../src/lib/jobs/presentation";
import { HEADER_NOTE_PRIORITY } from "../../src/lib/jobs/list-header";
import { suggestionLabel, suggestionsFromAnswer } from "../../src/lib/search-suggestions";
import { EMPLOYER_OWNS_DOMAIN_SHARE, namedCompoundEmployer, ownedDomains } from "../../src/lib/jobs/company-intent";
import {
    buildDomainNameCountQueries,
    buildRoleTitleCheckBody,
    mergeEmployerSuggestions,
    rankOwnedRows,
    readDomainNameCounts,
    titlesHoldRole,
} from "../../src/lib/jobs/meilisearch";
import { PRISTINE_FILTER_STATE } from "../../src/components/jobs/FilterPanel";
import type { EmployerRead, JobSearchResult, PublicJob } from "../../src/lib/jobs/types";

/**
 * Vivek, 2026-11-08: "searching product manager integral ad science should search for product manager jobs in that
 * company if it exists...if not, show integral ad science jobs followed by product manager jobs". One rule for a role
 * at one employer, however the employer arrived (named in the words, or chosen as the employer filter): the role at the
 * employer; else the employer's other roles, then the role at other employers, paged as one list, and said on the page.
 */

const job = (id: string, company: string, domain: string | null, title = "Role"): PublicJob =>
    ({ id, company, company_domain: domain, title }) as PublicJob;

const result = (hits: PublicJob[], total: number, extra: Partial<JobSearchResult> = {}): JobSearchResult => ({
    hits,
    total,
    backend: "meilisearch",
    configured: true,
    ...extra,
});

test("an employer chosen as the filter, with role words typed, is a role at that employer", () => {
    assert.deepEqual(chosenEmployerRole({ q: " product manager ", companyDomain: "Shopify.com" }), {
        domain: "shopify.com",
        role: "product manager",
    });
    // An employer browse (no words), an id probe, a board, several domains, a résumé's own lanes: not a role read.
    assert.equal(chosenEmployerRole({ companyDomain: "shopify.com" }), null);
    assert.equal(chosenEmployerRole({ q: "pm", companyDomain: "shopify.com", id: "x" }), null);
    assert.equal(chosenEmployerRole({ q: "pm", companyDomain: "shopify.com", board: "elite" }), null);
    assert.equal(chosenEmployerRole({ q: "pm", companyDomain: "shopify.com", companyDomains: ["a.com"] }), null);
    assert.equal(chosenEmployerRole({ q: "pm", companyDomain: "shopify.com", fromResume: true }), null);
    assert.equal(chosenEmployerRole({ q: '"Product Manager" OR "Product Owner"', companyDomain: "shopify.com" }), null);
});

test("pinning to an employer and taking the pin off touch only the employer fields", () => {
    assert.deepEqual(pinToEmployer({ q: "", companyDomains: ["old.com"], limit: 40 }, ["shopify.com"]), {
        q: "",
        companyDomain: "shopify.com",
        limit: 40,
    });
    assert.deepEqual(pinToEmployer({ q: "" }, ["a.com", "b.com"]), { q: "", companyDomains: ["a.com", "b.com"] });
    assert.deepEqual(withoutEmployer({ q: "pm", companyDomain: "shopify.com", limit: 40 }), { q: "pm", limit: 40 });
});

test("the fallback list pages as one list: every row once, the employer's first, no gap and no repeat across pages", () => {
    for (const employerTotal of [0, 1, 39, 40, 41, 95]) {
        const roleTotal = 70;
        const listed: string[] = [];
        for (let offset = 0; offset < employerTotal + roleTotal; offset += 40) {
            const limit = 40;
            const own = Array.from({ length: Math.max(0, Math.min(limit, employerTotal - offset)) }, (_, i) => `e${offset + i}`);
            const window = employerFallbackWindow(employerTotal, offset, limit);
            const others = window
                ? Array.from({ length: Math.max(0, Math.min(window.limit, roleTotal - window.offset)) }, (_, i) => `r${window.offset + i}`)
                : [];
            assert.ok(own.length + others.length <= limit);
            listed.push(...own, ...others);
        }
        const expected = [
            ...Array.from({ length: employerTotal }, (_, i) => `e${i}`),
            ...Array.from({ length: roleTotal }, (_, i) => `r${i}`),
        ];
        assert.deepEqual(listed, expected, `employer total ${employerTotal}`);
    }
});

test("the joined result lists the employer's roles, then the role elsewhere, counts both, and keeps that order", () => {
    const employer = result([job("e1", "Shopify", "shopify.com", "Data Analyst"), job("e2", "Shopify", "shopify.com")], 2);
    const role = result([job("e2", "Shopify", "shopify.com"), { ...job("r1", "Acme", "acme.com", "Product Manager"), tier: 1 }], 120, {
        facetDistribution: { work_type: { remote: 3 } },
    });
    const read = { domains: ["shopify.com"], role: "product manager", source: "typed" as const };
    const joined = joinEmployerFallback(employer, role, read, true);
    assert.deepEqual(joined.hits.map((h) => h.id), ["e1", "e2", "r1"]);
    assert.equal(joined.total, 122);
    assert.equal(joined.hits[2].tier, undefined, "no tier: the page must not re-split the list around the role words");
    assert.equal(joined.effectiveQ, "");
    assert.deepEqual(joined.employer, { ...read, name: "Shopify", roleMatches: 0, employerRoles: 2 });
    // A page inside the employer's roles shows none of the role's rows, but still counts them.
    const inside = joinEmployerFallback(employer, role, read, false);
    assert.deepEqual(inside.hits.map((h) => h.id), ["e1", "e2"]);
    assert.equal(inside.total, 122);
});

test("an employer's name is read from its own rows only", () => {
    const hits = [job("1", "Acme", "acme.com"), job("2", "Shopify Inc.", "shopify.com")];
    assert.equal(employerNameFromHits(hits, ["shopify.com"]), "Shopify");
    assert.equal(employerNameFromHits(hits, ["nobody.com"]), undefined);
});

const read = (over: Partial<EmployerRead>): EmployerRead => ({
    domains: ["integralads.com"],
    name: "Integral Ad Science",
    role: "product manager",
    roleMatches: 0,
    employerRoles: 12,
    source: "typed",
    ...over,
});

test("the page says what the list is when the employer has none of the role, and nothing when it has", () => {
    assert.equal(
        employerRoleNote(read({}), 300),
        "No product manager roles at Integral Ad Science right now — showing its other roles first, then product manager roles at other employers.",
    );
    assert.equal(employerRoleNote(read({ employerRoles: 12 }), 12), "No product manager roles at Integral Ad Science right now — showing its other roles.");
    assert.equal(
        employerRoleNote(read({ employerRoles: 0 }), 288),
        "No roles at Integral Ad Science right now — showing product manager roles at other employers.",
    );
    // No name read: the domain stands in.
    assert.match(employerRoleNote(read({ name: undefined }), 300) ?? "", /at integralads\.com right now/);
    assert.equal(employerRoleNote(read({ roleMatches: 4 }), 4), null);
    assert.equal(employerRoleNote(undefined, 10), null);
    // The note outranks the "Searched …" line: it changes what the person is looking at.
    assert.ok(HEADER_NOTE_PRIORITY.indexOf("employer") < HEADER_NOTE_PRIORITY.indexOf("understood"));
    // An agent is told how the search was read when the employer has the role.
    assert.equal(employerReadNote(read({ roleMatches: 4 })), 'searched "product manager" at Integral Ad Science (integralads.com)');
    assert.equal(employerReadNote(read({})), null);
});

test("an employer read from the typed words becomes the employer filter and the box keeps only the role words", () => {
    const heard = withEmployerUnderstood(undefined, read({ roleMatches: 3, domains: ["shopify.com"], name: "Shopify" }));
    assert.deepEqual(heard, {
        params: { companyDomain: "shopify.com" },
        residualQ: "product manager",
        source: "deterministic",
        employerName: "Shopify",
    });
    // A place read from the same words stays.
    const withPlace = withEmployerUnderstood(
        { params: { facets: { location_country: ["Toronto"] } }, residualQ: "product manager shopify", source: "deterministic" },
        read({ domains: ["shopify.com"], name: "Shopify" }),
    );
    assert.deepEqual(withPlace?.params, { facets: { location_country: ["Toronto"] }, companyDomain: "shopify.com" });
    assert.equal(withPlace?.residualQ, "product manager");
    // The searcher's own employer filter, or a read over several domains, is not echoed.
    assert.equal(withEmployerUnderstood(undefined, read({ source: "chosen" })), undefined);
    assert.equal(withEmployerUnderstood(undefined, read({ domains: ["a.com", "b.com"] })), undefined);
    // Merged into filter state, it fills an empty employer filter and never replaces a chosen one.
    assert.equal(mergeUnderstood(PRISTINE_FILTER_STATE, { companyDomain: "shopify.com" }).companyDomain, "shopify.com");
    const chosen = { ...PRISTINE_FILTER_STATE, companyDomain: "acme.com" };
    assert.equal(mergeUnderstood(chosen, { companyDomain: "shopify.com" }), chosen);
});

test("a fallback list keeps its order on the page; every other list is interleaved by company", () => {
    const hits = [job("e1", "Shopify", "s"), job("e2", "Shopify", "s"), job("e3", "Shopify", "s"), job("r1", "Acme", "a")];
    assert.deepEqual(pageRowsInListOrder({ hits, employer: read({}) }).map((h) => h.id), ["e1", "e2", "e3", "r1"]);
    assert.deepEqual(pageRowsInListOrder({ hits }).map((h) => h.id), ["e1", "e2", "r1", "e3"]);
});

test("the box lists Roles, Related roles and Companies, employers first when the words name one, each pick carrying its employer", () => {
    const answer = {
        titles: ["Product Manager"],
        related: ["Product Owner"],
        companies: ["Shopify"],
        employers: [{ name: "Shopify", domain: "shopify.com", role: "product manager" }],
    };
    const rows = suggestionsFromAnswer(answer);
    assert.deepEqual(rows.map((r) => r.type), ["role", "related", "company"]);
    assert.deepEqual(suggestionsFromAnswer({ ...answer, employersFirst: true }).map((r) => r.type), ["company", "role", "related"]);
    const company = rows.find((r) => r.type === "company")!;
    assert.equal(company.domain, "shopify.com");
    assert.equal(suggestionLabel(company), "product manager at Shopify");
    assert.equal(suggestionLabel({ text: "Shopify", type: "company", domain: "shopify.com" }), "Shopify");
    // An answer from before employers existed still lists its company names, as text searches.
    assert.deepEqual(suggestionsFromAnswer({ titles: [], companies: ["Acme"] }), [{ text: "Acme", type: "company" }]);
});

/*
 * Release 74's live check (2026-11-08): "product manager integral ad science" listed a data scientist at a bank with
 * no note, "bank of america" in the box listed the employer twice, and one pick filtered to a job board.
 */
test("the whole query's rows stand only when one of them is the role; the check is not paged", () => {
    assert.equal(titlesHoldRole(["Senior Data Scientist", "Software Test Engineer"], "product manager"), false);
    assert.equal(titlesHoldRole(["Senior Data Scientist", "Sr. Product Managers, Ads"], "product manager"), true);
    assert.equal(titlesHoldRole([], "product manager"), false);
    const body = buildRoleTitleCheckBody({ q: " product manager integral ad science ", offset: 80, limit: 20 });
    assert.equal(body.q, "product manager integral ad science");
    assert.equal(body.offset, 0, "every page of one list gets the same answer");
    assert.deepEqual(body.attributesToRetrieve, ["title"]);
    assert.equal(body.matchingStrategy, "all");
});

test("an employer the corpus knows by name below the floors is still named, with every domain its rows carry", () => {
    const candidates = [{ roleQ: "product manager", companyQ: "bank of america" }];
    const sample = { total: 3, companies: ["Bank of America", "Bank of America", "Territorial Bank of American Samoa"], domains: ["board.example", "bofa.example", "tbas.example"], titles: [] };
    assert.deepEqual(namedCompoundEmployer(candidates, [sample]), { ...candidates[0], domains: ["board.example", "bofa.example"], name: "Bank of America" });
    assert.equal(namedCompoundEmployer(candidates, [{ ...sample, companies: ["Territorial Bank of American Samoa"], domains: ["tbas.example"] }]), null);
});

test("a domain is an employer's own when most of its live rows carry the name; a board that lists one is not", () => {
    const counts = readDomainNameCounts(
        ["board.example", "bofa.example"],
        [{ facetDistribution: { company_domain: { "Board.example": 1, "bofa.example": 2 } } }, { facetDistribution: { company_domain: { "board.example": 50, "bofa.example": 2 } } }],
    );
    assert.deepEqual([...(counts ?? [])], [["board.example", { named: 1, total: 50 }], ["bofa.example", { named: 2, total: 2 }]]);
    assert.deepEqual(ownedDomains(["board.example", "bofa.example"], counts), ["bofa.example"]);
    assert.equal(EMPLOYER_OWNS_DOMAIN_SHARE, 0.5);
    // No counts (the index cannot count by domain, or the call failed): the domains stand, as before the check.
    assert.equal(readDomainNameCounts(["a.example"], [{}]), null);
    assert.deepEqual(ownedDomains(["a.example"], null), ["a.example"]);
    const queries = buildDomainNameCountQueries("Bank of America", ["bofa.example"]);
    assert.deepEqual(queries.map((q) => [q.q, q.attributesToSearchOn ?? null, q.limit, q.facets]), [
        ["Bank of America", ["company"], 0, ["company_domain"]],
        ["", null, 0, ["company_domain"]],
    ]);
});

test("the box lists an employer once, on the domain it owns best, and never on a domain it does not own", () => {
    const board = { name: "Bank of America", domain: "board.example" };
    const own = { name: "Bank of America", domain: "bofa.example" };
    const other = { name: "Territorial Bank of American Samoa", domain: "tbas.example" };
    const share = (row: { domain: string }) => ({ "board.example": 0.02, "bofa.example": 1, "tbas.example": 0.9 })[row.domain] ?? 0;
    assert.deepEqual(rankOwnedRows([board, other, own], { share }), [own, board, other]);
    const owns = (row: { domain: string }) => share(row) >= EMPLOYER_OWNS_DOMAIN_SHARE;
    assert.deepEqual(mergeEmployerSuggestions("bank of america", [[board, own, other]], owns).employers, [own, other]);
    // One row per name even where both domains are owned.
    assert.deepEqual(mergeEmployerSuggestions("bank of america", [[own, { ...own, domain: "bofa2.example" }]]).employers, [own]);
});
