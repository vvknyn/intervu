/**
 * A nudge reorders a list inside a fit band and never lifts a title the résumé does not hold above one it does, and
 * a work-mode, employment or region word is never a tune term or label. Vivek, 2026-10-15: Today read "Tuned away
 * from Product Manager and Remote", and taps on Product Manager roles let SecOps, Salesforce administration and
 * support roles rise above a Product Manager résumé's own roles on a list of eleven.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tuneRank } from "../../src/lib/jobs/for-you/band-order";
import { tuneToday, type TodayRole } from "../../src/lib/jobs/for-you/today";
import {
    roleFeatures,
    roleName,
    roleTerms,
    sanitizeNudge,
    summarizeTuning,
    tuneDeck,
    type TuneRank,
    type TuningNudge,
    type TuningSignal,
} from "../../src/lib/jobs/for-you/tuning";
import type { MatchScore } from "../../src/lib/match/score";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.UTC(2026, 9, 15);

function job(id: string, title: string, extra: Partial<PublicJob> = {}): PublicJob {
    return {
        id,
        title,
        company: `Company ${id}`,
        company_domain: null,
        location_country: "CA",
        work_type: "hybrid",
        experience_level: "senior",
        apply_url: "https://example.com/apply",
        ...extra,
    } as PublicJob;
}

const nudge = (target: PublicJob, signal: TuningSignal, deck: PublicJob[], own = false): TuningNudge => ({
    jobId: target.id,
    signal,
    at: NOW,
    features: roleFeatures(target, deck, { own, signal }),
});

const ids = (jobs: readonly PublicJob[]) => jobs.map((j) => j.id);

describe("tuneDeck keeps a nudge inside its band", () => {
    // A product résumé's list as ranked: its own roles, then roles it does not hold, all of one band.
    const pm1 = job("pm1", "Senior Product Manager, Payments");
    const pm2 = job("pm2", "Product Manager, Platform");
    const pm3 = job("pm3", "Senior Technical Product Manager");
    const secops = job("secops", "SecOps Engineer");
    const sf = job("sf", "Senior Salesforce Administrator");
    const support = job("support", "Application Support Analyst");
    const deck = [pm1, pm2, pm3, secops, sf, support];
    const held = new Set(["pm1", "pm2", "pm3"]);
    const rankOf = (j: PublicJob): TuneRank => ({ band: 0, held: held.has(j.id) });
    const indexOf = (list: readonly PublicJob[], id: string) => list.findIndex((j) => j.id === id);

    it("fewer like this on a Product Manager role no longer puts a role the résumé does not hold above the résumé's own", () => {
        const nudges = [nudge(pm1, "fewer", deck)];
        const unbound = tuneDeck(deck, nudges, [], NOW);
        assert.ok(
            unbound.some((j) => !held.has(j.id) && indexOf(unbound, j.id) < indexOf(unbound, "pm2")),
            `without the rule the nudge buries the Product Manager roles: ${ids(unbound)}`,
        );
        const tuned = tuneDeck(deck, nudges, [], NOW, rankOf);
        for (const own of ["pm1", "pm2", "pm3"]) for (const other of ["secops", "sf", "support"]) assert.ok(indexOf(tuned, own) < indexOf(tuned, other), `${own} before ${other}: ${ids(tuned)}`);
    });

    it("still reorders the roles inside the band: more like this on one kind of work the résumé holds brings its roles forward", () => {
        const kinds = [job("pmA", "Product Manager, Payments"), job("pmB", "Product Manager, Growth"), job("csm1", "Customer Success Manager"), job("csm2", "Customer Success Manager, Enterprise"), secops];
        const heldKinds = new Set(["pmA", "pmB", "csm1", "csm2"]);
        const tuned = tuneDeck(kinds, [nudge(kinds[2]!, "more", kinds)], [], NOW, (j) => ({ band: 0, held: heldKinds.has(j.id) }));
        assert.deepEqual(ids(tuned), ["csm1", "csm2", "pmA", "pmB", "secops"]);
    });

    it("more like this on a role the résumé does not hold cannot lift it over the résumé's own roles", () => {
        const tuned = tuneDeck(deck, [nudge(secops, "more", deck)], [], NOW, rankOf);
        assert.deepEqual(ids(tuned).slice(0, 3), ["pm1", "pm2", "pm3"], ids(tuned).join());
        assert.equal(indexOf(tuned, "secops"), 3, "and it leads the roles the résumé does not hold");
    });

    it("lets a role the résumé holds rise above ones it does not hold that led it", () => {
        const mixed = [secops, sf, pm1, pm2, pm3, support];
        const tuned = tuneDeck(mixed, [nudge(pm2, "more", mixed)], [], NOW, rankOf);
        assert.ok(held.has(tuned[0]!.id), `a role it holds leads: ${ids(tuned)}`);
    });

    it("never moves a role out of its fit band, either way", () => {
        const strong = [pm1, pm2];
        const good = [pm3, secops];
        const base = [...strong, ...good];
        const band = (j: PublicJob): TuneRank => ({ band: strong.includes(j) ? 0 : 1, held: held.has(j.id) });
        for (const target of base) {
            for (const signal of ["more", "fewer"] as const) {
                const tuned = tuneDeck(base, [nudge(target, signal, base)], [], NOW, band);
                assert.deepEqual(ids(tuned.slice(0, 2)).sort(), ["pm1", "pm2"], `${signal} on ${target.id}: ${ids(tuned)}`);
                assert.deepEqual(ids(tuned.slice(2)).sort(), ["pm3", "secops"], `${signal} on ${target.id}: ${ids(tuned)}`);
            }
        }
    });

    it("keeps the roles already reached where they are", () => {
        const tuned = tuneDeck(deck, [nudge(pm1, "fewer", deck)], ["pm1"], NOW, rankOf);
        assert.equal(tuned[0]!.id, "pm1");
        assert.deepEqual(ids(tuned).slice(1, 4), ["pm2", "pm3", "secops"]);
    });

    it("leaves a role with no rank (not scored) in its place, after the ranked ones it follows", () => {
        const ranked = (j: PublicJob): TuneRank | null => (j.id === "support" ? null : rankOf(j));
        const tuned = tuneDeck(deck, [nudge(pm1, "fewer", deck)], [], NOW, ranked);
        assert.equal(tuned[5]!.id, "support");
    });

    it("is the same as before when nothing is held back: one band, every role held", () => {
        const everyone = () => ({ band: 0, held: true });
        const nudges = [nudge(pm1, "fewer", deck)];
        assert.deepEqual(ids(tuneDeck(deck, nudges, [], NOW, everyone)), ids(tuneDeck(deck, nudges, [], NOW)));
    });
});

describe("Today's picks keep a nudge inside the band and below no role the résumé holds", () => {
    const score = (role: MatchScore["role"], total: number): MatchScore => ({
        total,
        role,
        components: [{ key: "relevance", label: "", detail: "", score: total / 100 }],
    } as MatchScore);
    const posted = new Date(NOW - 2 * 86_400_000).toISOString();
    const pick = (id: string, title: string, role: MatchScore["role"], total: number): TodayRole => ({
        job: job(id, title, { posted_at: posted, posted_ts: Date.parse(posted) }),
        score: score(role, total),
    });
    // Strong: two Product Manager roles and one role the résumé does not hold (content-led); then a Good one.
    const picks = [
        pick("pm1", "Senior Product Manager, AI", "own", 100),
        pick("pm2", "Senior Technical Product Manager", "own", 96),
        pick("owner", "Platform Owner, Payments APIs", "unverified", 92),
        pick("pm3", "Product Manager, Advertising", "own", 82),
    ];

    it("fewer like this on a Product Manager role leaves the Strong roles it holds above the one it does not", () => {
        const deckJobs = picks.map((p) => p.job);
        const tuned = tuneToday(picks, [nudge(picks[0]!.job, "fewer", deckJobs)], [], NOW);
        const order = tuned.map((p) => p.job.id);
        assert.ok(order.indexOf("pm1") < order.indexOf("owner") && order.indexOf("pm2") < order.indexOf("owner"), order.join());
        assert.equal(order[3], "pm3", "the Good role stays after the Strong band");
    });

    it("rank: the band is the one order's group, a role it holds is its own role or the same kind of work", () => {
        const a = tuneRank(score("own", 100), picks[0]!.job, NOW);
        const b = tuneRank(score("family", 95), picks[0]!.job, NOW);
        const c = tuneRank(score("unverified", 95), picks[0]!.job, NOW);
        const d = tuneRank(score("own", 70), picks[0]!.job, NOW);
        assert.equal(a.held && b.held, true);
        assert.equal(c.held, false);
        assert.equal(a.band, c.band, "Strong and Strong are one band");
        assert.notEqual(a.band, d.band, "Strong and Good are two");
    });
});

describe("a work-mode, employment or region word is no tune term", () => {
    it("is not a term of the role, in its title or its tags", () => {
        const terms = roleTerms(job("r", "Senior Product Manager (Remote)", { work_type: "remote", tags: ["Remote", "SaaS", "Full-Time"] }));
        assert.ok(!terms.includes("w:remote") && !terms.includes("g:remote"), terms.join());
        assert.ok(terms.includes("t:remote"), "where it is worked stays with its own term");
        assert.ok(terms.includes("g:saas"));
        assert.ok(terms.includes("w:product") && terms.includes("w:manager"));
    });

    it("leaves a place named in the title to the posting's own place, and a word that is a kind of role as it was", () => {
        const toronto = roleTerms(job("t", "Product Manager Toronto", { location_city: "Toronto", location: "Toronto, Ontario, Canada" }));
        assert.ok(!toronto.includes("w:toronto") && toronto.includes("p:toronto"), toronto.join());
        assert.ok(roleTerms(job("c", "Contract Manager")).includes("w:contract"));
        assert.ok(roleTerms(job("g", "Global Mobility Manager")).includes("w:global"));
        assert.ok(roleTerms(job("o", "Office Manager")).includes("w:office"));
        assert.ok(roleTerms(job("e", "Product Manager, EMEA")).every((t) => t !== "w:emea"));
    });

    it("is not part of the role's name", () => {
        assert.equal(roleName("Remote Product Manager"), "Product Manager");
        assert.equal(roleName("Product Manager - Remote"), "Product Manager");
        assert.equal(roleName("Senior Remote Product Manager (Canada)"), "Product Manager");
        assert.equal(roleName("Part-Time Product Manager"), "Product Manager");
        assert.equal(roleName("Contract Manager"), "Contract Manager", "a word that is a kind of role stays");
    });

    it("can never be the label a tap leaves: the line does not say \"away from Remote\"", () => {
        // In a deck where the title word "Remote" is what sets a posting apart.
        const target = job("t1", "Product Manager Remote", { work_type: "remote" });
        const deck = [target, job("a", "Product Manager, Growth"), job("b", "Product Manager, Platform"), job("c", "Product Manager, Payments")];
        for (const own of [false, true]) {
            const features = roleFeatures(target, deck, { own, signal: "fewer" });
            assert.notEqual(features.label.toLowerCase(), "remote", `own ${own}: ${features.label}`);
            assert.ok(!features.terms.includes("w:remote"));
        }
    });

    it("is read out of a nudge stored before this rule, so the line on a device that has it stops saying it", () => {
        const stored = (id: string): TuningNudge => ({
            jobId: id,
            signal: "fewer",
            at: NOW,
            features: { role: "Product Manager", label: "Remote", terms: ["w:product", "w:manager", "w:remote", "g:remote", "t:remote"], own: true },
        });
        assert.deepEqual(summarizeTuning([stored("1"), stored("2")], NOW), { toward: [], away: ["Remote"] }, "as the line read before");
        const clean = [stored("1"), stored("2")].map(sanitizeNudge);
        assert.equal(summarizeTuning(clean, NOW), null);
        assert.deepEqual(clean[0]!.features.terms, ["w:product", "w:manager", "t:remote"]);
        assert.equal(sanitizeNudge(clean[0]!), clean[0], "a clean nudge is returned as it is");
    });

    it("is read out of the nudges the store loads", async () => {
        const { loadNudges, DECK_TUNING_KEY } = await import("../../src/lib/jobs/for-you/tuning-store");
        const raw = JSON.stringify([
            { jobId: "1", signal: "fewer", at: NOW, features: { role: "Product Manager", label: "Remote", terms: ["w:remote", "w:product"] } },
            { jobId: "2", signal: "fewer", at: NOW, features: { role: "Product Manager", label: "Product Manager", terms: ["w:product", "w:manager"] } },
        ]);
        const holder = globalThis as unknown as { window?: unknown };
        const before = holder.window;
        holder.window = { localStorage: { getItem: (key: string) => (key === DECK_TUNING_KEY ? raw : null), setItem: () => undefined } };
        try {
            const loaded = loadNudges(NOW);
            assert.deepEqual(loaded.map((n) => n.features.label), ["", "Product Manager"]);
            assert.deepEqual(loaded[0]!.features.terms, ["w:product"]);
        } finally {
            holder.window = before;
        }
    });
});
