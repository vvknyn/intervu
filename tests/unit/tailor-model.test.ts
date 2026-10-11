import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { lineAsks, postingAsks, withLeaveOuts } from "../../src/lib/local-ai/tailor-asks";
import { wordStem } from "../../src/lib/local-ai/tailor-ground";
import { applyTailorChanges, resumeFullText, startsOn, type TailorDraft } from "../../src/lib/local-ai/tailor-resume";
import {
    cleanModelLine,
    groundDraft,
    linePrompt,
    tailorWithModel,
    tailorWithRules,
    type Generate,
} from "../../src/lib/local-ai/tailor-with-engine";
import { descriptionToBullets } from "../../src/lib/resume/merge-bullet-lines";
import type { ResumeData } from "../../src/types/resume";
import { LONG_RESUME_POSTINGS, TAILOR_POSTINGS } from "../fixtures/job-descriptions/tailor-postings";

/**
 * The on-device model's part of Customize résumé (tailor-with-engine.ts
 * `tailorWithModel`): each line that answers one of the posting's asks is
 * rewritten toward that ask, one model call per line, and the summary from
 * the strongest of them. Vivek 2026-10-10, shown a Claude rewrite: "there must
 * be something we could hack together to let the on device models be as
 * effective".
 *
 * The models (Chrome's Gemini Nano, Llama 3.2 3B on WebGPU) can't run here,
 * so these tests answer each prompt with a recorded reply in their style:
 * good rewrites, rewrites that borrow the posting's words, and the slips small
 * models make (a number, a tool, another employer, a ramble).
 */

const DIR = path.join(process.cwd(), "tests/fixtures");

async function readResume(file: string): Promise<ResumeData> {
    const parsed = (await parseResumeLocally(readFileSync(path.join(DIR, file), "utf8"), { skipDownload: true })).data.parsed;
    return { ...parsed, generatedSummary: parsed.generatedSummary ?? "" };
}

/** Answers a line prompt with `lines[the line]`, the summary prompt with `summary`; records every prompt. */
function recorded(lines: Record<string, string>, summary?: string) {
    const prompts: string[] = [];
    const generate: Generate = async (prompt) => {
        prompts.push(prompt);
        const line = prompt.match(/The résumé line: "(.*)"\n/)?.[1];
        if (line !== undefined) return lines[line] ?? null;
        return /The current summary:/.test(prompt) ? (summary ?? null) : null;
    };
    return { generate, prompts };
}

const opts = { engineId: "webllm" as const, engineLabel: "On-device · Llama-3.2-3B-Instruct" };
const nurseJob = TAILOR_POSTINGS["nurse-ca"]!;
const pmJob = LONG_RESUME_POSTINGS["vivek-pm-resume.txt"]!;

const lineChange = (draft: TailorDraft, before: string) =>
    draft.changes.find((c) => c.kind === "line" && c.before === before) as Extract<TailorDraft["changes"][number], { kind: "line" }> | undefined;

describe("postingAsks / lineAsks: which line answers which ask", () => {
    it("reads the posting's asks, not its headings, benefits or boilerplate", () => {
        const asks = postingAsks(
            "Responsibilities:\n- Triage and assess patients using CTAS.\n- Document care in the electronic health record.\nWe offer dental and vision benefits.\nWe are an equal opportunity employer.\nAbout us",
        );
        assert.deepEqual(asks.map((a) => a.text), ["Triage and assess patients using CTAS.", "Document care in the electronic health record."]);
    });

    it("pairs each nurse line with the ask it is evidence for, by shared words or a same-group verb", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const pairs = lineAsks(nurse, postingAsks(nurseJob.description!));
        const askFor = (start: string) => pairs.find((p) => p.line.startsWith(start))?.ask.text;
        assert.equal(askFor("Triage up to 40"), "Triage and assess patients using CTAS and develop nursing care plans.");
        assert.equal(askFor("Charted all"), "Document assessments and interventions in the electronic health record.");
        assert.equal(askFor("Precept new"), "Provide patient education and mentor new nurses.");
        assert.equal(askFor("Cared for"), "Administer medications and IV therapy and provide wound care.");
    });
});

describe("cleanModelLine: the rewrite out of a small model's reply", () => {
    it("drops a preamble, label, bullet and quotes, and ends the way the line ends", () => {
        assert.equal(cleanModelLine('Here is the rewritten line:\n"Documented all assessments in Epic."', "Charted all assessments in Epic."), "Documented all assessments in Epic.");
        assert.equal(cleanModelLine("Rewritten line: - Mentor new graduate nurses.", "Precept new graduate nurses"), "Mentor new graduate nurses");
        assert.equal(cleanModelLine("“Owned the backlog”\n\nThis keeps every fact.", "Managed the backlog."), "Owned the backlog.");
        assert.equal(cleanModelLine("  \n ", "x"), null);
    });
});

describe("tailorWithModel: the nurse, rewritten toward the emergency posting", () => {
    const LINES = {
        // On: every word is the line's, the résumé's, or a same-meaning posting word ("Mentor" for "Precept").
        "Precept new graduate nurses through their first twelve weeks on the unit.":
            "Mentor new graduate nurses through their first twelve weeks on the unit.",
        // On: "Provided" is how the ask itself puts doing wound care.
        "Cared for six to eight post-operative patients per shift, including IV therapy and wound care.":
            "Provided IV therapy and wound care for six to eight post-operative patients per shift.",
        // Would need an OK ("electronic", "record" are the posting's, not the résumé's), so the rules'
        // own rewording of this line, "Documented ... in Epic.", stays on instead.
        "Charted all assessments and medication administration in Epic.":
            "Documented all assessments and medication administration in Epic, the electronic health record.",
        // Dropped: a number the line doesn't have.
        "Triage up to 40 patients a shift using CTAS and start care plans with the physician team.":
            "Triage and assess up to 45 patients a shift using CTAS and develop nursing care plans with the physician team.",
    };
    const SUMMARY =
        "Registered nurse with seven years of acute care on emergency and medical-surgical units, known for calm CTAS triage, clear patient education and mentoring new nurses.";

    it("rewrites each line toward its ask, one call per line, then the summary", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const { generate, prompts } = recorded(LINES, SUMMARY);
        const draft = await tailorWithModel(nurse, nurseJob, generate, opts);
        assert.equal(prompts.length, 5, "four lines and the summary");
        assert.match(prompts[0], /The posting asks: "Triage and assess patients using CTAS and develop nursing care plans\."/);
        assert.equal(draft.engineLabel, opts.engineLabel);

        const mentor = lineChange(draft, "Precept new graduate nurses through their first twelve weeks on the unit.");
        assert.equal(mentor?.after, LINES["Precept new graduate nurses through their first twelve weeks on the unit."]);
        assert.ok(mentor && startsOn(mentor));
        assert.match(mentor!.why, /^Rewritten on this device to answer the posting's “Provide patient education and mentor new nurses”\.$/);

        const provided = lineChange(draft, "Cared for six to eight post-operative patients per shift, including IV therapy and wound care.");
        assert.equal(provided?.after, "Provided IV therapy and wound care for six to eight post-operative patients per shift.");
        assert.ok(provided && startsOn(provided));

        const summary = draft.changes.find((c) => c.kind === "summary");
        assert.equal(summary?.kind === "summary" && summary.after, SUMMARY);
    });

    it("offers a rewrite that borrows the posting's words, off until the person turns it on", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const triage = "Triage up to 40 patients a shift using CTAS and start care plans with the physician team.";
        const offered = "Triage and assess up to 40 patients a shift using CTAS and develop nursing care plans with the physician team.";
        const draft = await tailorWithModel(nurse, nurseJob, recorded({ ...LINES, [triage]: offered }, SUMMARY).generate, opts);
        const change = lineChange(draft, triage);
        assert.equal(change?.after, offered);
        assert.deepEqual(change?.confirm, ["develop"]);
        assert.ok(!startsOn(change!));
        assert.match(change!.why, / Adds the posting's “develop”: use it only if that's true\.$/);
        const lines = (r: ResumeData) => r.experience.flatMap((e) => descriptionToBullets(e.description));
        assert.ok(!lines(draft.tailored).includes(offered), "the tailored résumé leaves it off");
        assert.ok(lines(applyTailorChanges(draft.base, draft.changes)).includes(offered), "turned on, it is used");
        // The gate keeps it: the words it adds are named on it.
        assert.ok(groundDraft(resumeFullText(nurse), draft).changes.some((c) => c.id === change!.id));
    });

    it("keeps the rules' rewording on where the model's would need the person's OK", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const draft = await tailorWithModel(nurse, nurseJob, recorded(LINES, SUMMARY).generate, opts);
        const charted = lineChange(draft, "Charted all assessments and medication administration in Epic.");
        assert.equal(charted?.after, "Documented all assessments and medication administration in Epic.");
        assert.ok(charted && startsOn(charted));
        assert.match(charted!.why, /^Uses the posting's words/);
    });

    it("drops a rewrite with a number the line doesn't have; that line keeps the rules' wording", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const draft = await tailorWithModel(nurse, nurseJob, recorded(LINES, SUMMARY).generate, opts);
        assert.ok(!draft.changes.some((c) => (c.kind === "line" || c.kind === "summary") && /\b45\b/.test(c.after)));
    });

    it("drops a tool, another employer or a ramble the line doesn't have", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const slips = {
            "Charted all assessments and medication administration in Epic.": "Documented all assessments and medication administration in Epic and Cerner.",
            "Precept new graduate nurses through their first twelve weeks on the unit.":
                "Mentor new graduate nurses at St. Michael's Hospital through their first twelve weeks on the unit.",
            "Cared for six to eight post-operative patients per shift, including IV therapy and wound care.":
                "Provided IV therapy and wound care for six to eight post-operative patients per shift while also coordinating discharge planning, family meetings, pain management protocols and handover reports for the whole unit.",
        };
        const draft = await tailorWithModel(nurse, nurseJob, recorded(slips, "Registered nurse with seven years of ICU care.").generate, opts);
        for (const c of draft.changes) {
            if (c.kind !== "line" && c.kind !== "summary") continue;
            assert.doesNotMatch(c.after, /Cerner|St\. Michael's Hospital through|discharge|ICU/, c.after);
        }
    });

    it("gives the rules draft when the model answers nothing", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const draft = await tailorWithModel(nurse, nurseJob, async () => null, opts);
        assert.deepEqual(draft, tailorWithRules(nurse, nurseJob));
    });

    it("says how far it has got, and starts no new line past its time budget", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const seen: [number, number][] = [];
        let clock = 0;
        const { generate, prompts } = recorded(LINES, SUMMARY);
        await tailorWithModel(nurse, nurseJob, async (p, o) => ((clock += 40_000), generate(p, o)), {
            ...opts,
            now: () => clock,
            budgetMs: 60_000,
            onProgress: (done, total) => seen.push([done, total]),
        });
        assert.equal(prompts.length, 2, "the third call would start past the budget");
        assert.deepEqual(seen, [[0, 5], [1, 5]]);
    });

    it("never writes a summary for a résumé without one", async () => {
        const nurse = { ...(await readResume("resume-corpus/nurse-ca.paste.txt")), generatedSummary: "" };
        const { generate, prompts } = recorded(LINES, SUMMARY);
        const draft = await tailorWithModel(nurse, nurseJob, generate, opts);
        assert.ok(!prompts.some((p) => /The current summary:/.test(p)));
        assert.equal(draft.tailored.generatedSummary, "");
    });
});

describe("tailorWithModel: a product manager's résumé (Vivek's) toward a PM posting", () => {
    it("leads lines with the posting's asks in the résumé's own words", async () => {
        const pm = await readResume("vivek-pm-resume.txt");
        const before = {
            transition: "Delivered a zero-defect API transition for 950K+ users, owning scope, backlog, and release coordination across 6 production regions.",
            discovery:
                "Accelerated product adoption by 80% by catching data-consistency issues during client discovery and shipping a custom ETL solution that standardized inputs for new-client onboarding.",
        };
        const { generate, prompts } = recorded({
            [before.transition]: "Owned the backlog, scope and release coordination for a zero-defect API transition serving 950K+ users across 6 production regions.",
            [before.discovery]: "Led client discovery, catching data-consistency issues and shipping a custom ETL solution that accelerated product adoption by 80%.",
        });
        const draft = await tailorWithModel(pm, pmJob, generate, opts);
        assert.ok(prompts.length > 2);
        assert.equal(lineChange(draft, before.transition)?.after, "Owned the backlog, scope and release coordination for a zero-defect API transition serving 950K+ users across 6 production regions.");
        assert.equal(lineChange(draft, before.discovery)?.after, "Led client discovery, catching data-consistency issues and shipping a custom ETL solution that accelerated product adoption by 80%.");
        assert.match(lineChange(draft, before.discovery)!.why, /“Lead discovery with customers and translate requirements into shippable releases”/);
        // A rewrite is one line toward one ask: its prompt carries that line and that ask only.
        assert.equal(prompts.filter((p) => p.includes(before.transition)).length, 1);
        assert.equal(linePrompt({ line: "x y z w", ask: postingAsks("Own the product roadmap and backlog.")[0]! }).split("\n").length, 8);
    });

    it("offers to leave out a project the posting asks nothing about, off until turned on", async () => {
        const pm = await readResume("vivek-pm-resume.txt");
        const draft = withLeaveOuts(tailorWithRules({ ...pm, projects: pm.projects?.slice(0, 1) }, pmJob), pmJob);
        const leave = draft.changes.filter((c) => c.kind === "leave-out");
        for (const c of leave) assert.ok(!startsOn(c));
        assert.equal(draft.tailored.projects?.length, 1, "the tailored résumé keeps it until the person says");
        if (leave.length > 0) assert.equal(applyTailorChanges(draft.base, draft.changes).projects?.length, 0);
    });
});

describe("tailorWithModel: a warehouse supervisor toward a distribution lead posting (any field)", () => {
    /** Fabricated (no real person); the same résumé and posting as journey J-RESUME-51. */
    const WAREHOUSE: ResumeData = {
        profile: { name: "Marco Bianchi", profession: "Warehouse Supervisor", yearsOfExperience: 8, location: "Mississauga, ON", email: "marco.e2e@example.com", phone: "" },
        experience: [
            {
                id: "exp1",
                company: "Northgate Distribution",
                role: "Warehouse Supervisor",
                dates: "2018 - Present",
                description: [
                    "• Led a crew of 12 pickers across two shifts to hit shipping deadlines",
                    "• Improved picking accuracy by rebuilding the slotting plan",
                    "• Trained new hires on forklift safety and the WMS scanners",
                ].join("\n"),
            },
        ],
        projects: [{ id: "proj1", company: "Eastside Community Garden", role: "Volunteer coordinator", dates: "2020 - Present", description: "• Built raised beds and ran the spring seed swap" }],
        competencies: [{ category: "Operations", skills: ["Forklift", "Inventory Control", "Shipping and Receiving", "Team Leadership"] }],
        education: [{ id: "edu1", degree: "Diploma, Supply Chain Management", institution: "Sheridan College", year: "2016" }],
        generatedSummary: "Warehouse supervisor with 8 years in distribution centres, focused on safe and accurate shipping.",
    } as ResumeData;
    const job = {
        title: "Distribution Centre Lead",
        company: "Harbourline Logistics",
        tags: [],
        description:
            "Lead a team of warehouse associates across shifts to meet daily shipping targets. Improve picking accuracy and inventory control in the warehouse management system. Train and coach associates on safety procedures.",
    };
    const ANSWERS = {
        "Led a crew of 12 pickers across two shifts to hit shipping deadlines": "Led a team of 12 pickers across two shifts to meet daily shipping targets",
        "Improved picking accuracy by rebuilding the slotting plan": "Improved picking accuracy by 30% by rebuilding the slotting plan",
        "Trained new hires on forklift safety and the WMS scanners": "Trained new hires on safety for the forklift and the WMS scanners",
    };
    const SUMMARY_ANSWER = "Warehouse supervisor with 8 years in distribution centres who led a crew of 12 pickers across two shifts and trained new hires on forklift safety.";

    it("rewrites in the résumé's words, offers the posting's, drops a new number, and sums up the lines' own figures", async () => {
        const draft = await tailorWithModel(WAREHOUSE, job, recorded(ANSWERS, SUMMARY_ANSWER).generate, opts);
        const trained = lineChange(draft, "Trained new hires on forklift safety and the WMS scanners");
        assert.ok(trained && startsOn(trained));
        const led = lineChange(draft, "Led a crew of 12 pickers across two shifts to hit shipping deadlines");
        assert.deepEqual(led?.confirm, ["meet", "daily", "targets"]);
        assert.ok(!lineChange(draft, "Improved picking accuracy by rebuilding the slotting plan"), "30% is not on the résumé");
        const summary = draft.changes.find((c) => c.kind === "summary");
        assert.equal(summary?.kind === "summary" && summary.after, SUMMARY_ANSWER, "12 is the résumé's own figure");
        assert.ok(summary && startsOn(summary));
        assert.ok(draft.changes.some((c) => c.kind === "leave-out" && c.entryId === "proj1" && !startsOn(c)));
    });

    it("reads a verb ending in -er and its past as one word (administer, delivered)", () => {
        assert.equal(wordStem("administered"), wordStem("administer"));
        assert.equal(wordStem("delivering"), wordStem("deliver"));
        assert.equal(wordStem("assess"), "assess");
    });
});
