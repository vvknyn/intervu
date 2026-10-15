import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { startsOn, type TailorDraft } from "../../src/lib/local-ai/tailor-resume";
import { rulesTailorDraft } from "../../src/lib/local-ai/tailor-rules";
import { tailorWithRules } from "../../src/lib/local-ai/tailor-with-engine";
import { rulesTailor } from "../../src/lib/agent/tailor-tool";
import {
    acceptedCount,
    acceptedResume,
    choiceKey,
    choiceOf,
    CHOICES_KEPT,
    CHOICES_KEPT_MS,
    decisionsFor,
    fingerprint,
    proposeChanges,
    pruneChoices,
    reviewSections,
    type Decision,
    type StoredChoice,
} from "../../extension/src/tailor-review";
import { attachedNote } from "../../extension/src/fill-note";
import { jobFromPage, type PageRead } from "../../extension/src/page-reader";
import { tailoringJob } from "../../extension/src/report";
import type { PublicJob } from "../../src/lib/jobs/types";
import type { ResumeData } from "../../src/types/resume";
import { TAILOR_POSTINGS } from "../fixtures/job-descriptions/tailor-postings";

/**
 * Approving a tailored résumé one change at a time (extension/src/tailor-review.ts):
 * nothing is applied until accepted, and the résumé a PDF or a copy is made
 * from has the accepted changes and no others, for every résumé in the corpus
 * (tests/fixtures/resume-corpus) tailored to a posting for its kind of role.
 */

async function readResume(id: string): Promise<ResumeData> {
    const text = readFileSync(path.join(process.cwd(), "tests/fixtures/resume-corpus", `${id}.paste.txt`), "utf8");
    const parsed = (await parseResumeLocally(text)).data.parsed;
    return { ...parsed, generatedSummary: parsed.generatedSummary ?? "" };
}

const decide = (draft: TailorDraft, pick: (id: string, i: number) => Decision | null) => {
    const out = new Map<string, Decision>();
    draft.changes.forEach((c, i) => {
        const d = pick(c.id, i);
        if (d) out.set(c.id, d);
    });
    return out;
};

describe("the résumé is only changed by what the person accepted", () => {
    for (const [id, posting] of Object.entries(TAILOR_POSTINGS)) {
        it(`${id}: nothing accepted is the résumé as written, everything is the site's tailored résumé`, async () => {
            const base = await readResume(id);
            const draft = rulesTailorDraft(base, posting);
            assert.ok(draft.changes.length > 0, "something is proposed");
            const before = structuredClone(base);

            assert.deepEqual(acceptedResume(draft, new Map()), base, "no decisions");
            assert.deepEqual(acceptedResume(draft, decide(draft, () => "rejected")), base, "every change rejected");
            // The site starts with these on; accepting just those is its tailored résumé.
            const onByDefault = decide(draft, (cid) => (startsOn(draft.changes.find((c) => c.id === cid)!) ? "accepted" : null));
            assert.deepEqual(acceptedResume(draft, onByDefault), draft.tailored);
            assert.deepEqual(base, before, "the résumé it was proposed for is left as it was");
        });

        it(`${id}: each change alone touches only its own part of the résumé`, async () => {
            const base = await readResume(id);
            const draft = rulesTailorDraft(base, posting);
            for (const change of draft.changes) {
                const out = acceptedResume(draft, decide(draft, (cid) => (cid === change.id ? "accepted" : null)));
                assert.equal(acceptedCount(draft, decide(draft, (cid) => (cid === change.id ? "accepted" : null))), 1);
                const same = (part: "generatedSummary" | "experience" | "projects" | "competencies") => assert.deepEqual(out[part], base[part], `${change.id} left ${part} alone`);
                if (change.kind === "summary") {
                    assert.equal(out.generatedSummary, change.after);
                    same("experience");
                    same("competencies");
                } else if (change.kind === "skills") {
                    assert.deepEqual(out.competencies[change.group].skills, change.after);
                    same("generatedSummary");
                    same("experience");
                    same("projects");
                } else {
                    same("generatedSummary");
                    same("competencies");
                }
            }
        });

        it(`${id}: every change is listed once, with the person's text beside the proposal and the reason`, async () => {
            const draft = rulesTailorDraft(await readResume(id), posting);
            const items = reviewSections(draft).flatMap((s) => s.items);
            assert.deepEqual(items.map((i) => i.id).sort(), draft.changes.map((c) => c.id).sort());
            for (const item of items) {
                assert.ok(item.why.trim(), `${item.id} says why`);
                assert.ok(item.before.trim(), `${item.id} shows the person's own text`);
                assert.ok(item.after.trim(), `${item.id} shows what is proposed`);
                if (item.kind === "line" || item.kind === "summary") assert.notEqual(item.after, item.before, `${item.id} proposes something different`);
            }
        });
    }
});

describe("what is remembered", () => {
    const posting = TAILOR_POSTINGS["nurse-ca"]!;

    it("keeps the decisions as marks, with no text from the résumé", async () => {
        const draft = rulesTailorDraft(await readResume("nurse-ca"), posting);
        const decisions = decide(draft, (_id, i) => (i % 2 === 0 ? "accepted" : "rejected"));
        const stored = choiceOf(draft, decisions, "2026-10-07T15:00:00Z", 1_000);
        assert.equal(stored.accepted.length + stored.rejected.length, draft.changes.length);
        for (const mark of [...stored.accepted, ...stored.rejected]) assert.match(mark, /^[\w:.-]+#[0-9a-z]+$/, "an id and a hash, nothing else");
        assert.deepEqual(decisionsFor(draft, stored, "2026-10-07T15:00:00Z"), decisions);
    });

    it("drops the decisions when the résumé was saved again since", async () => {
        const draft = rulesTailorDraft(await readResume("nurse-ca"), posting);
        const stored = choiceOf(draft, decide(draft, () => "accepted"), "2026-10-07T15:00:00Z", 1_000);
        assert.equal(decisionsFor(draft, stored, "2026-10-09T09:00:00Z").size, 0);
        assert.equal(decisionsFor(draft, stored, null).size, 0);
        assert.equal(decisionsFor(draft, null, "2026-10-07T15:00:00Z").size, 0);
    });

    it("asks again about a change that reads differently now", async () => {
        const draft = rulesTailorDraft(await readResume("nurse-ca"), posting);
        const stored = choiceOf(draft, decide(draft, () => "accepted"), null, 1_000);
        const changed = structuredClone(draft);
        const summary = changed.changes.find((c) => c.kind === "summary");
        assert.ok(summary && summary.kind === "summary", "the nurse's summary is tailored");
        summary.after = `${summary.after} Also: something else.`;
        assert.notEqual(fingerprint(summary), fingerprint(draft.changes.find((c) => c.id === summary.id)!));
        const now = decisionsFor(changed, stored, null);
        assert.equal(now.has(summary.id), false, "the reworded summary is undecided");
        assert.equal(now.size, draft.changes.length - 1, "the others keep what the person decided");
    });

    it("a rejected change stays rejected, an undecided one stays undecided", async () => {
        const draft = rulesTailorDraft(await readResume("nurse-ca"), posting);
        const decisions = decide(draft, (_id, i) => (i === 0 ? "rejected" : null));
        const again = decisionsFor(draft, choiceOf(draft, decisions, null, 1), null);
        assert.deepEqual([...again], [[draft.changes[0].id, "rejected"]]);
    });

    it("keeps the latest 40 jobs and nothing older than 60 days", () => {
        const now = 100 * 86_400_000;
        const choice = (at: number): StoredChoice => ({ at, resumeAt: null, accepted: [], rejected: [] });
        const all: Record<string, StoredChoice> = { old: choice(now - CHOICES_KEPT_MS - 1) };
        for (let i = 0; i < CHOICES_KEPT + 5; i++) all[`job${i}`] = choice(now - i * 1_000);
        const kept = pruneChoices(all, now);
        assert.equal(Object.keys(kept).length, CHOICES_KEPT);
        assert.ok(!("old" in kept));
        assert.ok("job0" in kept && !(`job${CHOICES_KEPT + 4}` in kept), "the most recent stay");
    });

    it("names a job by employer and title, and by neither when the title is unknown", () => {
        assert.equal(choiceKey({ title: "Registered Nurse - ICU", company: "Cedarbrook Health" }), "cedarbrook health|registered nurse icu");
        assert.equal(choiceKey({ title: "registered nurse, ICU!", company: "CEDARBROOK  Health" }), "cedarbrook health|registered nurse icu");
        assert.equal(choiceKey({ title: "", company: "Cedarbrook Health" }), null);
    });
});

describe("the same draft as velai.app's", () => {
    it("is the site's rules tailor and the MCP tailor_resume draft", async () => {
        const base = await readResume("nurse-ca");
        const job = TAILOR_POSTINGS["nurse-ca"]!;
        assert.deepEqual(rulesTailorDraft(base, job), tailorWithRules(base, job));
        const published = { id: "j1", ...job } as unknown as PublicJob;
        assert.deepEqual(await rulesTailor(base, published), proposeChanges(base, published));
    });
});

describe("the posting the changes are proposed for", () => {
    const READ: PageRead = {
        url: "https://careers.example.org/jobs/rn",
        title: "Registered Nurse | Example Health",
        text: "",
        posting: { title: "Registered Nurse", hiringOrganization: { "@type": "Organization", name: "Example Health" }, description: "<p>IV therapy and charting in Epic for critically ill adults on our unit.</p>" },
    };
    const velai = (description: string): PublicJob => ({ ...jobFromPage(READ), id: "velai-1", source: "company_site", description });

    it("is Velai's copy, or the page's own words when those are fuller", () => {
        const page = jobFromPage(READ);
        assert.equal(tailoringJob(READ, page, null), page);
        const full = velai("A long description of the role that is fuller than anything the page itself says about it, in every way.");
        assert.equal(tailoringJob(READ, page, full), full);
        const short = velai("IV.");
        assert.equal(tailoringJob(READ, page, short).description, page.description);
        assert.equal(tailoringJob(READ, page, short).id, "velai-1");
    });

    it("never uses a page's loose text over Velai's copy", () => {
        const loose: PageRead = { ...READ, posting: null };
        const page = { ...jobFromPage(READ), description: "x".repeat(500) };
        const copy = velai("short");
        assert.equal(tailoringJob(loose, page, copy), copy);
    });
});

describe("what the card says about the résumé it attached", () => {
    it("says nothing when nothing was proposed", () => assert.equal(attachedNote({ accepted: 0, proposed: 0 }), ""));
    it("says the résumé went in as written, and that changes wait, when none was accepted", () => {
        assert.equal(attachedNote({ accepted: 0, proposed: 3 }), " Your résumé went in as you wrote it; 3 proposed changes are waiting for your OK in the panel.");
        assert.equal(attachedNote({ accepted: 0, proposed: 1 }), " Your résumé went in as you wrote it; 1 proposed change is waiting for your OK in the panel.");
    });
    it("says how many of the proposed changes it carries", () => {
        assert.equal(attachedNote({ accepted: 2, proposed: 3 }), " Your résumé went in with the 2 of 3 proposed changes you accepted.");
        assert.equal(attachedNote({ accepted: 1, proposed: 1 }), " Your résumé went in with the 1 of 1 proposed change you accepted.");
    });
});
