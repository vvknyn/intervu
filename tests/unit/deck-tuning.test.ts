import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    addNudge,
    decay,
    HALF_LIFE_MS,
    maxShift,
    reachedIds,
    deckTermWeights,
    roleFeatures,
    roleName,
    roleNudge,
    roleTerms,
    summarizeTuning,
    tuneDeck,
    tuningLine,
    type TuningNudge,
    type TuningSignal,
} from "../../src/lib/jobs/for-you/tuning";
import type { PublicJob } from "../../src/lib/jobs/types";

const NOW = Date.UTC(2026, 9, 1);
const DAY = 24 * 60 * 60 * 1000;

function job(id: string, title: string, extra: Partial<PublicJob> = {}): PublicJob {
    return {
        id,
        title,
        company: `Company ${id}`,
        company_domain: null,
        location_country: "CA",
        work_type: "hybrid",
        experience_level: "mid",
        apply_url: "https://example.com/apply",
        ...extra,
    } as PublicJob;
}

function nudge(target: PublicJob, signal: TuningSignal, deck: PublicJob[] = [], at = NOW): TuningNudge {
    return { jobId: target.id, signal, at, features: roleFeatures(target, deck) };
}

const ids = (jobs: PublicJob[]) => jobs.map((j) => j.id);

/** A TAM's deck as ranked: own role first, then neighbours. */
function tamDeck(): PublicJob[] {
    return [
        job("tam1", "Senior Technical Account Manager"),
        job("pm1", "Senior Product Manager, Payments"),
        job("pm2", "Staff Product Manager"),
        job("csm1", "Customer Success Manager"),
        job("pm3", "Product Manager - Growth"),
        job("tpm1", "Technical Program Manager"),
        job("pm4", "Product Manager, Platform"),
        job("pm5", "Senior Product Manager"),
        job("tam2", "Technical Account Manager II"),
        job("csm2", "Senior Customer Success Manager"),
        job("pm6", "Group Product Manager"),
        job("tam3", "Technical Account Manager, Enterprise - Canada"),
    ];
}

describe("roleName", () => {
    it("drops rank words and qualifiers, keeps the role", () => {
        assert.equal(roleName("Sr. Technical Account Manager, Enterprise - Europe"), "Technical Account Manager");
        assert.equal(roleName("Technical Account Manager II"), "Technical Account Manager");
        assert.equal(roleName("Registered Nurse (ICU)"), "Registered Nurse");
        assert.equal(roleName("Lead Teacher - Grade 5"), "Teacher");
        assert.equal(roleName("Staff Software Engineer | Payments"), "Software Engineer");
        assert.equal(roleName("Senior"), "Senior", "a title that is only a rank word stays as it is");
    });

    it("keeps the work a title names after its post", () => {
        assert.equal(roleName("Director, Technical Account Management"), "Director, Technical Account Management");
        assert.equal(roleName("Sr. Director, Technical Account Management"), "Director, Technical Account Management");
        assert.equal(roleName("Manager, Customer Success"), "Manager, Customer Success");
        assert.equal(roleName("VP, Sales"), "VP, Sales");
        assert.equal(roleName("Head of Nursing - Surgical"), "Head of Nursing");
    });
});

describe("tuneDeck", () => {
    it("leaves the ranked deck alone with no nudges", () => {
        const deck = tamDeck();
        assert.equal(tuneDeck(deck, [], [], NOW), deck);
    });

    it("more like this on a TAM role brings the next TAM roles forward, and hides nothing", () => {
        const deck = tamDeck();
        const tuned = tuneDeck(deck, [nudge(deck[0], "more", deck)], ["tam1"], NOW);
        assert.deepEqual(new Set(ids(tuned)), new Set(ids(deck)), "a nudge never removes a role");
        assert.equal(tuned[0].id, "tam1", "the role the visitor is on stays put");
        assert.equal(tuned[1].id, "tam2", "the closest TAM role, 8th before, comes up next");
        assert.ok(ids(tuned).indexOf("tam3") <= 4, `the last TAM role, 12th before, moves into the next few: ${ids(tuned).join(", ")}`);
    });

    it("fewer like this on a PM role moves the PM roles down", () => {
        const deck = tamDeck();
        const tuned = tuneDeck(deck, [nudge(deck[1], "fewer", deck)], ["tam1"], NOW);
        const firstPm = ids(tuned).findIndex((id) => id.startsWith("pm"));
        const lastOther = Math.max(...["csm1", "tpm1", "tam2"].map((id) => ids(tuned).indexOf(id)));
        assert.ok(firstPm > lastOther, `PM roles after the rest: ${ids(tuned).join(", ")}`);
        assert.equal(tuned.length, deck.length);
    });

    it("weighs what sets a role apart: a TAM nudge barely moves PM roles", () => {
        const deck = tamDeck();
        const weight = deckTermWeights(deck.slice(1).map(roleTerms));
        const more = [nudge(deck[0], "more", deck)];
        const pm = roleNudge(roleTerms(deck[1]), more, NOW, weight);
        const tam = roleNudge(roleTerms(deck[8]), more, NOW, weight);
        assert.ok(tam > 0.5, `TAM II nudged ${tam}`);
        assert.equal(pm, 0, "a PM role shares only words every role here has");
    });

    it("fewer like this on a security TAM role, in a TAM's deck, means fewer security roles, not fewer TAM roles", () => {
        const deck = [
            job("t0", "Technical Account Manager"),
            job("s1", "Technical Account Manager, Security"),
            job("t1", "Senior Technical Account Manager"),
            job("s2", "Security Technical Account Manager"),
            job("t2", "Technical Account Manager II"),
            job("t3", "Enterprise Technical Account Manager"),
            job("s3", "Technical Account Manager - Cloud Security"),
            job("t4", "Technical Account Manager, Strategic Accounts"),
            job("t5", "Technical Account Manager"),
        ];
        const fewer = nudge(deck[1], "fewer", deck);
        assert.equal(fewer.features.label, "Security");
        const rest = deck.filter((j) => j.id !== "s1");
        const tuned = tuneDeck(rest, [fewer], ["t0"], NOW);
        assert.deepEqual(ids(tuned).slice(0, 6), ["t0", "t1", "t2", "t3", "t4", "t5"], "the TAM roles keep their order");
        assert.deepEqual(ids(tuned).slice(6).sort(), ["s2", "s3"], "the security roles wait at the end, still there");
        assert.deepEqual(summarizeTuning([fewer], NOW), { toward: [], away: ["Security"] });
    });

    it("never moves the roles already reached", () => {
        const deck = tamDeck();
        const passed = ["tam1", "pm1", "pm2"];
        const tuned = tuneDeck(deck, [nudge(deck[1], "fewer", deck)], passed, NOW);
        assert.deepEqual(ids(tuned).slice(0, 3), passed);
    });

    it("moves a fully nudged role by at most what is left to see (at least 12 places)", () => {
        const deck = Array.from({ length: 40 }, (_, i) => job(`r${i}`, "Data Analyst"));
        deck[39] = job("nurse", "Registered Nurse");
        const liked = [nudge(job("x", "Registered Nurse"), "more"), nudge(job("y", "Registered Nurse"), "more")];
        const tuned = tuneDeck(deck, liked, ["r0"], NOW);
        assert.equal(maxShift(39), 39);
        assert.equal(maxShift(5), 12);
        assert.equal(ids(tuned).indexOf("nurse"), 1, "from last to next");
    });

    it("in a deck of one role, fewer like this moves the roles that share what set it apart", () => {
        const deck = [
            ...Array.from({ length: 12 }, (_, i) =>
                job(`p${i}`, i % 3 === 0 ? "Physiotherapist - Outpatient Orthopaedics" : "Physiotherapist"),
            ),
            job("k1", "Kinesiologist"),
        ];
        const fewer = nudge(deck[3], "fewer", deck);
        const tuned = tuneDeck(deck.filter((j) => j.id !== "p3"), [fewer], ["p0"], NOW);
        const outpatient = ids(tuned).filter((id) => ["p6", "p9"].includes(id));
        assert.deepEqual(ids(tuned).slice(-2).sort(), outpatient.sort(), `outpatient roles last: ${ids(tuned).join(", ")}`);
        assert.equal(tuned.length, deck.length - 1, "nothing hidden");
    });

    it("works the same in other fields: nursing and teaching", () => {
        const nursing = [
            job("n0", "Registered Nurse - Med/Surg"),
            job("a1", "Medical Office Assistant"),
            job("a2", "Unit Clerk"),
            job("a3", "Patient Care Aide"),
            job("n1", "Registered Nurse, ICU"),
        ];
        const tunedNursing = tuneDeck(nursing, [nudge(nursing[0], "more", nursing)], ["n0"], NOW);
        assert.deepEqual(ids(tunedNursing).slice(0, 2), ["n0", "n1"]);

        const teaching = [
            job("t0", "Grade 3 Teacher"),
            job("e1", "Early Childhood Educator"),
            job("t1", "Elementary Teacher"),
            job("t2", "Occasional Teacher"),
            job("c1", "Curriculum Coordinator"),
        ];
        const tunedTeaching = tuneDeck(teaching, [nudge(teaching[0], "fewer", teaching)], [], NOW);
        assert.deepEqual(ids(tunedTeaching).slice(0, 2), ["e1", "c1"]);
    });

    it("lets a role's skills and company carry a nudge when titles differ", () => {
        const deck = [
            job("a", "Solutions Consultant", { must_have_skills: ["Salesforce", "SQL", "APIs"], skills_section_found: true, company: "Northwind" }),
            job("b", "Implementation Specialist", { must_have_skills: ["Salesforce", "SQL"], skills_section_found: true, company: "Northwind" }),
            job("c", "Office Manager"),
            job("d", "Account Coordinator"),
        ];
        const weight = deckTermWeights(deck.slice(1).map(roleTerms));
        const liked = [nudge(deck[0], "more", deck)];
        assert.ok(roleNudge(roleTerms(deck[1]), liked, NOW, weight) > 0, "shared skills and company");
        assert.equal(roleNudge(roleTerms(deck[2]), liked, NOW, weight), 0, "a shared country and level alone is not enough");
    });

    it("ignores skills a posting has no skills section for", () => {
        const terms = roleTerms(job("a", "Solutions Consultant", { must_have_skills: ["Salesforce", "SQL"] }));
        assert.equal(terms.filter((term) => term.startsWith("s:")).length, 0);
    });
});

/** A nudge given on the candidate's own kind of role (match/score.ts `roleAffinity` "own"). */
function ownNudge(target: PublicJob, signal: TuningSignal, deck: PublicJob[] = [], at = NOW): TuningNudge {
    return { jobId: target.id, signal, at, features: roleFeatures(target, deck, { own: true, signal }) };
}

describe("a thumbs-down on the candidate's own kind of role", () => {
    /** A TAM's deck: TAM roles at several companies among customer success roles, and one more HashiCorp role. */
    const deck = [
        job("t0", "Technical Account Manager", { company: "HashiCorp" }),
        job("c1", "Customer Success Manager", { company: "Shopify" }),
        job("t1", "Senior Technical Account Manager", { company: "Datadog" }),
        job("c2", "Enterprise Customer Success Manager", { company: "Faire" }),
        job("t2", "Technical Account Manager II", { company: "Okta" }),
        job("h1", "Solutions Engineer", { company: "HashiCorp" }),
        job("c3", "Customer Success Manager", { company: "Wealthsimple" }),
        job("t3", "Technical Account Manager", { company: "Twilio" }),
    ];
    const rest = deck.slice(1);

    it("steers by what else set that posting apart, not by the role", () => {
        const fewer = ownNudge(deck[0], "fewer", deck);
        assert.equal(fewer.features.label, "HashiCorp");
        const tuned = tuneDeck(rest, [fewer], [], NOW);
        assert.deepEqual(ids(tuned).filter((id) => id !== "h1"), ids(rest).filter((id) => id !== "h1"), "the TAM roles keep their places");
        assert.equal(ids(tuned).at(-1), "h1", "the other HashiCorp role waits at the end, still there");
        assert.equal(tuningLine(summarizeTuning([fewer], NOW)!), "Tuned away from HashiCorp.");
    });

    it("still means fewer of a role that isn't the candidate's own", () => {
        const tuned = tuneDeck(rest, [nudge(deck[0], "fewer", deck)], [], NOW);
        const lastCsm = Math.max(...["c1", "c2", "c3"].map((id) => ids(tuned).indexOf(id)));
        assert.ok(["t1", "t2", "t3"].every((id) => ids(tuned).indexOf(id) > lastCsm), `TAM roles after the rest: ${ids(tuned).join(", ")}`);
    });

    it("a skip on one moves nothing but that employer's roles either", () => {
        const tuned = tuneDeck(rest, [ownNudge(deck[0], "skip", deck)], [], NOW);
        assert.deepEqual(ids(tuned).filter((id) => id !== "h1"), ids(rest).filter((id) => id !== "h1"));
    });

    it("says nothing when nothing else set the posting apart", () => {
        const same = [job("a", "Technical Account Manager"), job("b", "Technical Account Manager"), job("c", "Customer Success Manager")];
        const fewer = ownNudge(same[0], "fewer", same);
        assert.equal(fewer.features.label, "");
        assert.equal(summarizeTuning([fewer], NOW), null);
        assert.deepEqual(ids(tuneDeck(same.slice(1), [fewer], [], NOW)), ["b", "c"], "and moves no other TAM role");
    });

    it("still moves what sets the role apart within it: fewer security TAM roles", () => {
        const tams = [
            job("t0", "Technical Account Manager"),
            job("s1", "Technical Account Manager, Security"),
            job("t1", "Senior Technical Account Manager"),
            job("s2", "Security Technical Account Manager"),
            job("t2", "Technical Account Manager II"),
            job("s3", "Technical Account Manager - Cloud Security"),
            job("t3", "Technical Account Manager"),
        ];
        const fewer = ownNudge(tams[1], "fewer", tams);
        assert.equal(fewer.features.label, "Security");
        const tuned = tuneDeck(tams.filter((j) => j.id !== "s1"), [fewer], ["t0"], NOW);
        assert.deepEqual(ids(tuned).slice(0, 4), ["t0", "t1", "t2", "t3"]);
        assert.deepEqual(ids(tuned).slice(4).sort(), ["s2", "s3"]);
    });

    it("leaves a thumbs-up on the candidate's own role as it was", () => {
        const tam = tamDeck();
        const more = ownNudge(tam[0], "more", tam);
        assert.equal(more.features.label, "Technical Account Manager");
        assert.equal(tuneDeck(tam, [more], ["tam1"], NOW)[1].id, "tam2");
    });

    it("works the same in other fields: one nurse posting turned down leaves the other nursing roles in place", () => {
        const nursing = [
            job("n0", "Registered Nurse - Med/Surg", { company: "Sunnybrook" }),
            job("p1", "Personal Support Worker", { company: "Bayshore" }),
            job("n1", "Registered Nurse - Emergency", { company: "Mount Sinai" }),
            job("u1", "Unit Clerk", { company: "Sunnybrook" }),
            job("n2", "Registered Nurse", { company: "Humber River" }),
            job("p2", "Personal Support Worker", { company: "SE Health" }),
        ];
        const fewer = ownNudge(nursing[0], "fewer", nursing);
        const tuned = tuneDeck(nursing.slice(1), [fewer], [], NOW);
        assert.deepEqual(ids(tuned).filter((id) => id.startsWith("n")), ["n1", "n2"]);
        assert.ok(ids(tuned).indexOf("n1") < ids(tuned).indexOf("p2"), `nurse roles keep their place: ${ids(tuned).join(", ")}`);
        assert.equal(ids(tuned).at(-1), "u1", "the other Sunnybrook role goes last");
    });
});

describe("nudges fade", () => {
    it("count half after two weeks and a quarter after four", () => {
        assert.equal(decay(0), 1);
        assert.equal(decay(HALF_LIFE_MS), 0.5);
        assert.equal(decay(28 * DAY), 0.25);
    });
});

describe("addNudge", () => {
    const tam = job("tam1", "Technical Account Manager");

    it("keeps one nudge per role, a tap replacing anything", () => {
        let list = addNudge([], nudge(tam, "dwell"));
        list = addNudge(list, nudge(tam, "more"));
        assert.deepEqual(list.map((n) => n.signal), ["more"]);
        list = addNudge(list, nudge(tam, "fewer"));
        assert.deepEqual(list.map((n) => n.signal), ["fewer"]);
    });

    it("never lets a quieter signal override a tap or a stronger one", () => {
        let list = addNudge([], nudge(tam, "more"));
        list = addNudge(list, nudge(tam, "dwell"));
        assert.deepEqual(list.map((n) => n.signal), ["more"]);
        list = addNudge([], nudge(tam, "save"));
        list = addNudge(list, nudge(tam, "dwell"));
        assert.deepEqual(list.map((n) => n.signal), ["save"]);
        list = addNudge(list, nudge(tam, "apply"));
        assert.deepEqual(list.map((n) => n.signal), ["apply"]);
    });

    it("drops nudges too old to count", () => {
        const old = nudge(job("old", "Data Analyst"), "more", [], NOW - 90 * DAY);
        const list = addNudge([old], nudge(tam, "more"), NOW);
        assert.deepEqual(list.map((n) => n.jobId), ["tam1"]);
    });
});

describe("summarizeTuning", () => {
    it("names the role a tap leans toward, and the role skips lean away from", () => {
        const deck = [
            job("tam", "Sr. Technical Account Manager"),
            job("tam2", "Technical Account Manager"),
            ...["Senior Product Manager", "Product Manager II", "Staff Product Manager", "Product Manager"].map((t, i) => job(`pm${i}`, t)),
            job("csm", "Customer Success Manager"),
        ];
        const nudges = [nudge(deck[0], "more", deck), ...deck.slice(2, 5).map((p) => nudge(p, "skip", deck))];
        const summary = summarizeTuning(nudges, NOW);
        assert.deepEqual(summary, { toward: ["Technical Account Manager"], away: ["Product Manager"] });
        assert.equal(tuningLine(summary!), "Tuned toward Technical Account Manager, away from Product Manager.");
    });

    it("names a post-first title in full: \"Director, Technical Account Management\", not \"Technical\"", () => {
        const deck = [
            job("d", "Director, Technical Account Management"),
            job("c1", "Senior Customer Success Manager"),
            job("t1", "Technical Account Manager"),
            job("c2", "Customer Success Manager"),
        ];
        const more = nudge(deck[0], "more", deck);
        assert.equal(tuningLine(summarizeTuning([more], NOW)!), "Tuned toward Director, Technical Account Management.");
    });

    it("says nothing for a single skip or a role read for a while", () => {
        assert.equal(summarizeTuning([nudge(job("a", "Product Manager"), "skip")], NOW), null);
        assert.equal(summarizeTuning([nudge(job("b", "Product Manager"), "dwell")], NOW), null);
    });
});

describe("reachedIds", () => {
    const deck = tamDeck();

    it("marks every role up to the one stepped to", () => {
        assert.deepEqual(reachedIds(deck, [], 2), ["tam1", "pm1", "pm2"]);
    });

    it("keeps further roles reached when the visitor steps back", () => {
        const passed = ["tam1", "pm1", "pm2"];
        assert.equal(reachedIds(deck, passed, 1), passed);
    });
});
