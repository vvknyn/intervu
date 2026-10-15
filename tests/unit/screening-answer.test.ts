import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseResumeLocally } from "../../src/lib/local-ai/parse-resume";
import { resumeFullText } from "../../src/lib/local-ai/tailor-resume";
import { resumeWordSet } from "../../src/lib/local-ai/tailor-ground";
import { acceptReply, draftScreeningAnswer, estimateTokens, rulesAnswer, screeningMessages, ANSWER_MAX_TOKENS } from "../../src/lib/screening/answer";
import { screeningEvidence, scrubbedLine, EVIDENCE_MAX } from "../../src/lib/screening/evidence";
import { classifyQuestion, looksLikeQuestion, questionText, QUESTION_MAX_CHARS } from "../../src/lib/screening/question";
import type { SealedMessage } from "../../src/lib/sealed-ai/client";
import type { ResumeData } from "../../src/types/resume";
import { LONG_RESUME_POSTINGS, TAILOR_POSTINGS } from "../fixtures/job-descriptions/tailor-postings";

/**
 * Screening-answer drafts (Chrome extension 0.4.1, MCP draft_screening_answer):
 * which questions Velai drafts, which résumé lines a draft is made from and
 * sent with, what the model's reply must pass to be used, and what a request
 * carries, checked on every résumé in the corpus and the longer fixtures.
 */

const DIR = path.join(process.cwd(), "tests/fixtures");

async function readResume(file: string): Promise<ResumeData> {
    const parsed = (await parseResumeLocally(readFileSync(path.join(DIR, file), "utf8"))).data.parsed;
    return { ...parsed, generatedSummary: parsed.generatedSummary ?? "" };
}

const corpus = Object.entries(TAILOR_POSTINGS).map(([id, job]) => ({ file: `resume-corpus/${id}.paste.txt`, job }));
const longer = Object.entries(LONG_RESUME_POSTINGS).map(([file, job]) => ({ file, job }));
const CASES = [...corpus, ...longer];

describe("which questions are drafted", () => {
    const drafted = [
        "Why are you interested in this role?",
        "Describe your experience with project management.",
        "Tell us about a time you resolved a conflict with a coworker.",
        "What interests you about working at our company? *",
        "Question 3: Describe your experience with budgeting (required)",
        "In your own words, explain how you handle difficult customers.",
        "What is your biggest strength?",
        "How do you prioritise when everything is urgent?",
    ];
    for (const q of drafted) it(`drafts: ${q}`, () => assert.deepEqual(classifyQuestion(q), { draft: true }));

    const left: [string, string][] = [
        ["Are you legally authorized to work in Canada?", "work authorization and eligibility"],
        ["Will you now or in the future require visa sponsorship?", "work authorization and eligibility"],
        ["What gender do you identify with?", "personal and diversity questions"],
        ["Are you a protected veteran?", "personal and diversity questions"],
        ["What are your salary expectations?", "pay"],
        ["Desired compensation (annual)", "pay"],
        ["When can you start?", "start date and availability"],
        ["What is your notice period?", "start date and availability"],
        ["Are you willing to relocate?", "location, travel and schedule"],
        ["Are you comfortable working on-site five days a week?", "location, travel and schedule"],
        ["Have you ever been convicted of a felony?", "background checks and legal questions"],
        ["Do you consent to a background check?", "background checks and legal questions"],
        ["I agree to the privacy policy", "agreements and consent"],
        ["How did you hear about this job?", "where you heard about the job"],
        ["Have you previously worked for this company?", "your history with this employer"],
        ["Cover letter", "a cover letter or open note, not a question"],
        ["Additional information", "a cover letter or open note, not a question"],
        ["Pourquoi voulez-vous travailler chez nous et quelle est votre expérience?", "a question Velai can't read yet (English only)"],
        ["为什么你想申请这个职位？", "a question Velai can't read yet (English only)"],
        ["", "no question to answer"],
    ];
    for (const [q, reason] of left) it(`leaves to the person (${reason}): ${q || "(empty)"}`, () => assert.deepEqual(classifyQuestion(q), { draft: false, reason }));

    it("reads the question without the marks a form adds, on one line, cut to a length", () => {
        assert.equal(questionText("  Question 2:  Why do you want\n to work here? * (required) "), "Why do you want to work here?");
        const long = questionText(`Why ${"very ".repeat(200)}much?`);
        assert.ok(long.length <= QUESTION_MAX_CHARS && long.endsWith("…"));
    });

    it("tells a question from a plain field", () => {
        assert.equal(looksLikeQuestion("Why do you want to work here?"), true);
        assert.equal(looksLikeQuestion("Describe your experience with Python"), true);
        assert.equal(looksLikeQuestion("Current company"), false);
        assert.equal(looksLikeQuestion("First name"), false);
        assert.equal(looksLikeQuestion("LinkedIn profile"), false);
    });
});

describe("the résumé lines a question is answered from", () => {
    it("the nurse's IV therapy question gets the IV therapy line and the skills that name it", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const lines = screeningEvidence(nurse, "Describe your experience with IV therapy.", { title: "Charge Nurse" });
        assert.ok(lines.length > 0 && lines.length <= EVIDENCE_MAX);
        assert.ok(lines.some((l) => /IV therapy/i.test(l.text) && /Medical-Surgical/.test(l.where)), JSON.stringify(lines));
        assert.ok(lines.some((l) => l.source === "skills" && /IV Therapy/.test(l.text)), JSON.stringify(lines));
    });

    it("a broad question is answered from the summary and the lines about the role's title", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        const lines = screeningEvidence(nurse, "Why are you interested in this role?", { title: "Emergency Nurse" });
        assert.ok(lines.some((l) => l.source === "summary"), JSON.stringify(lines));
        assert.ok(lines.some((l) => /triage/i.test(l.text) || /emergency/i.test(l.text)), JSON.stringify(lines));
    });

    it("a question no line speaks to gets none", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        assert.deepEqual(screeningEvidence(nurse, "Describe your experience with Kubernetes clusters.", { title: "Nurse" }), []);
    });

    it("leaves out the person's name, email, phone and links, and a line that was mostly those", () => {
        const kept = scrubbedLine("Presented quarterly revenue results and forecast variances to the executive board and regional finance leads, copying Daniela Ortiz (daniela.ortiz@example.com).", "Daniela Ortiz");
        assert.equal(kept, "Presented quarterly revenue results and forecast variances to the executive board and regional finance leads, copying.");
        assert.equal(scrubbedLine("Email daniela.ortiz@example.com", "Daniela Ortiz"), null);
        assert.equal(scrubbedLine("Presented results to Daniela Ortiz (daniela.ortiz@example.com, 416-555-0134) at https://example.com/x each quarter.", "Daniela Ortiz"), null);
        assert.equal(scrubbedLine("Short", "Daniela Ortiz"), null);
    });

    it("a line that has the name in it reaches no one with it", async () => {
        const nurse = await readResume("resume-corpus/nurse-ca.paste.txt");
        nurse.experience[0].description = "• Mentored Ortiz-trained new graduate nurses with Daniela through triage at daniela.ortiz@example.com.";
        const sent = screeningEvidence(nurse, "Describe your experience with triage.", { title: "Nurse" }).map((l) => l.text).join("\n");
        assert.match(sent, /triage/i);
        assert.doesNotMatch(sent, /Daniela|daniela|example\.com/);
    });

    it("never more than four lines, each at most 280 characters", async () => {
        for (const { file, job } of CASES) {
            const resume = await readResume(file);
            for (const q of ["Why are you interested in this role?", "Tell us about your experience.", `Describe your experience with ${job.title}.`]) {
                const lines = screeningEvidence(resume, q, job);
                assert.ok(lines.length <= EVIDENCE_MAX, `${file}: ${lines.length} lines`);
                for (const l of lines) assert.ok(l.text.length <= 281, `${file}: ${l.text.length} characters`);
            }
        }
    });
});

describe("the reply a draft may be", () => {
    const known = "Triage up to 40 patients a shift using CTAS and start care plans with the physician team.\nWhy are you interested in this role?\nCharge Nurse\nHumber River Health";
    const vocabulary = resumeWordSet(known, ["interested", "role", "passionate"]);

    it("takes a reply made of the lines' own facts", () => {
        const reply = "I triage up to 40 patients a shift using CTAS and start care plans with the physician team, which is the work I would bring to this role.";
        assert.equal(acceptReply(reply, known, vocabulary), reply);
    });

    it("strips quotes and code fences around a reply", () => {
        const inner = "I triage up to 40 patients a shift using CTAS with the physician team.";
        assert.equal(acceptReply(`"${inner}"`, known, vocabulary), inner);
        assert.equal(acceptReply(`\`\`\`\n${inner}\n\`\`\``, known, vocabulary), inner);
    });

    const rejected: [string, string][] = [
        ["nothing", ""],
        ["too short", "I triage patients."],
        ["a number the lines do not have", "I triage up to 60 patients a shift using CTAS with the physician team."],
        ["a number word is fine but a new digit run is not", "I triage 40 patients and manage 12 beds using CTAS with the physician team."],
        ["a name the lines do not have", "I triage up to 40 patients a shift using CTAS with Cerner and the physician team."],
        ["an email", "I triage up to 40 patients a shift using CTAS; reach me at nurse@example.com for more."],
        ["a link", "I triage up to 40 patients a shift using CTAS, see https://example.com/me for detail."],
        ["a phone number", "I triage up to 40 patients a shift using CTAS, call 416 555 0134 for more."],
        ["the model declining", "I'm sorry, but I can't answer that from the lines provided to me."],
        ["no answer", "NO_ANSWER"],
        ["the person's name", "I, Daniela, triage up to 40 patients a shift using CTAS with the physician team."],
        ["several words the résumé has nowhere", "I triage up to 40 patients a shift using CTAS with orchestration, microservices, blockchain, observability."],
    ];
    for (const [why, reply] of rejected) {
        it(`refuses ${why}`, () => assert.equal(acceptReply(reply || null, known, vocabulary, "Daniela Ortiz"), null));
    }

    it("a reply with its own connecting words passes, up to three words the résumé lacks", () => {
        const reply = "I triage up to 40 patients a shift using CTAS and start care plans with the physician team, which prepares me well for this role.";
        assert.equal(acceptReply(reply, known, vocabulary), reply);
    });
});

describe("drafting an answer", () => {
    async function nurse() {
        const resume = await readResume("resume-corpus/nurse-ca.paste.txt");
        return { resume, job: { title: "Charge Nurse", company: "Northline Health" } };
    }

    it("a question left to the person is not drafted and nothing is sent", async () => {
        const { resume, job } = await nurse();
        let sent = 0;
        const out = await draftScreeningAnswer({ chat: async () => (sent++, "x") }, { resume, job, question: "Are you legally authorized to work in Canada?" });
        assert.deepEqual(out.verdict, { draft: false, reason: "work authorization and eligibility" });
        assert.equal(out.text, "");
        assert.equal(sent, 0);
    });

    it("a question no résumé line speaks to is not drafted and nothing is sent", async () => {
        const { resume, job } = await nurse();
        let sent = 0;
        const out = await draftScreeningAnswer({ chat: async () => (sent++, "x") }, { resume, job, question: "Describe your experience with Kubernetes clusters." });
        assert.deepEqual(out.verdict, { draft: false, reason: "no line on your résumé speaks to it" });
        assert.equal(out.by, null);
        assert.equal(sent, 0);
    });

    it("without AI the draft is the matching lines, marked as that", async () => {
        const { resume, job } = await nurse();
        const out = await draftScreeningAnswer({}, { resume, job, question: "Describe your experience with IV therapy." });
        assert.equal(out.by, "lines");
        assert.ok(out.text.length > 0);
        assert.match(out.text, /IV therapy/i);
        assert.equal(out.text, rulesAnswer(out.lines));
    });

    it("the sealed model's reply is the draft when it passes", async () => {
        const { resume, job } = await nurse();
        const out = await draftScreeningAnswer(
            { chat: async () => "I care for six to eight post-operative patients per shift, including IV therapy and wound care." },
            { resume, job, question: "Describe your experience with IV therapy." },
        );
        assert.equal(out.by, "sealed");
        assert.match(out.text, /IV therapy and wound care/);
        assert.ok(out.lines.length > 0);
    });

    it("a reply that uses a fact from a résumé line that was not sent is not used", async () => {
        const { resume, job } = await nurse();
        const out = await draftScreeningAnswer(
            { chat: async () => "I give IV therapy and wound care, and I chart every assessment in Epic." },
            { resume, job, question: "Describe your experience with IV therapy." },
        );
        assert.equal(out.by, "lines");
    });

    it("a reply that fails, throws, or is refused leaves the matching lines", async () => {
        const { resume, job } = await nurse();
        const question = "Describe your experience with IV therapy.";
        const rules = await draftScreeningAnswer({}, { resume, job, question });
        for (const chat of [
            async () => null,
            async () => {
                throw new Error("down");
            },
            async () => "I have ten years of IV therapy experience across Mayo Clinic and Johns Hopkins.",
            async () => "NO_ANSWER",
        ]) {
            const out = await draftScreeningAnswer({ chat }, { resume, job, question });
            assert.equal(out.by, "lines");
            assert.equal(out.text, rules.text);
        }
    });

    it("the request carries the question, the job, and only the matching lines: not the name, email, phone or location", async () => {
        const { resume, job } = await nurse();
        let sent: SealedMessage[] = [];
        let options: { maxTokens: number } | undefined;
        await draftScreeningAnswer(
            {
                chat: async (messages, o) => {
                    sent = messages;
                    options = o;
                    return null;
                },
            },
            { resume, job, question: "Describe your experience with IV therapy." },
        );
        const text = sent.map((m) => m.content).join("\n");
        assert.match(text, /Question: Describe your experience with IV therapy\./);
        assert.match(text, /Job: Charge Nurse at Northline Health/);
        assert.match(text, /IV therapy/i);
        for (const secret of ["Daniela", "Ortiz", resume.profile.email, "555-0134", "416", resume.profile.phone].filter(Boolean)) {
            assert.ok(!text.includes(secret), `${secret} is not sent`);
        }
        assert.ok(options!.maxTokens <= ANSWER_MAX_TOKENS && options!.maxTokens > 0);
        // A line of the résumé that no question bears on is not sent.
        assert.doesNotMatch(text, /Epic|Precept/);
        assert.doesNotMatch(text, /Toronto Metropolitan/);
    });
});

describe("the 22 cases: nothing identifying is sent, and a request stays small", () => {
    const stats: { file: string; tokens: number; lines: number }[] = [];

    for (const { file, job } of CASES) {
        it(`${file} → ${job.title}`, async () => {
            const resume = await readResume(file);
            const skill = resume.competencies.flatMap((c) => c.skills)[0] ?? job.title;
            const secrets = [
                ...resume.profile.name.split(/\s+/).filter((p) => p.replace(/[^\p{L}]/gu, "").length >= 3),
                resume.profile.email,
                resume.profile.phone,
                resume.profile.linkedin,
                resume.profile.website,
            ].filter((s): s is string => !!s && s.length >= 3);
            let drafted = 0;
            for (const question of ["Why are you interested in this role?", `Describe your experience with ${skill}.`, "Are you legally authorized to work in this country?", "What are your salary expectations?"]) {
                const requests: SealedMessage[][] = [];
                const out = await draftScreeningAnswer(
                    {
                        chat: async (messages) => {
                            requests.push(messages);
                            return null;
                        },
                    },
                    { resume, job: { title: job.title, company: job.company ?? "" }, question },
                );
                if (!out.verdict.draft) {
                    assert.equal(requests.length, 0, `${question}: nothing sent`);
                    continue;
                }
                assert.equal(requests.length, 1);
                assert.equal(out.by, "lines");
                const text = requests[0].map((m) => m.content).join("\n");
                for (const secret of secrets) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `${question}: ${secret} is not sent`);
                assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.\w+|https?:\/\//, "no email or link is sent");
                for (const line of out.lines) assert.ok(text.includes(line.text), "every sent line is one the draft cites");
                const tokens = estimateTokens(requests[0]);
                assert.ok(tokens <= 900, `${file}: ${tokens} tokens in`);
                stats.push({ file, tokens, lines: out.lines.length });
                drafted++;

                // The same lines make a reply the guard accepts, so the sealed path is open for this résumé.
                const echo = `I have done this work. ${out.lines.map((l) => l.text).join(" ")}`;
                const known = [...out.lines.map((l) => l.text), question, job.title, job.company ?? ""].join("\n");
                assert.ok(acceptReply(echo, known, resumeWordSet(resumeFullText(resume), known.toLowerCase().match(/[a-z]{4,}/g) ?? [])) !== null, `${file}: ${echo}`);
            }
            assert.ok(drafted >= 1, `${file}: at least the broad question is drafted`);
        });
    }

    it("prompt size", () => {
        assert.ok(stats.length >= CASES.length);
        const tokens = stats.map((s) => s.tokens).sort((a, b) => a - b);
        const mean = tokens.reduce((a, b) => a + b, 0) / tokens.length;
        if (process.env.SCREENING_COST) console.log(`requests ${tokens.length}, tokens in: min ${tokens[0]}, median ${tokens[tokens.length >> 1]}, mean ${mean.toFixed(0)}, max ${tokens.at(-1)}; tokens out capped at ${ANSWER_MAX_TOKENS}`);
        assert.ok(mean < 600, `mean ${mean}`);
        // The instructions are the same for every request.
        const empty = estimateTokens(screeningMessages({ job: { title: "", company: "" }, question: "" }, []));
        assert.ok(empty > 60 && empty < 200, `instructions ${empty} tokens`);
    });
});
