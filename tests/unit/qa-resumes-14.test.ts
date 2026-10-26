/**
 * The 14 synthetic résumés QA graded on 2026-10-26 (tests/fixtures/qa-resumes-14).
 * People, companies and contacts are fictional. Each file is read the way an
 * upload is — text PDFs through extractPDFTextInBrowser, DOCX through mammoth,
 * scans through tesseract.js then tidyOcrText — and compared with ground_truth.json:
 * name, title, location, years, each role's title and employer, and that role's
 * bullets living on the experience entry rather than in skills.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractPDFTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import { ocrPageText, tidyOcrText, type OcrBlock } from "@/lib/local-ai/ocr-pdf";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";

const require = createRequire(path.join(process.cwd(), "package.json"));
const mammoth = require("mammoth") as {
    extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
};
const { createWorker, OEM } = require("tesseract.js") as typeof import("tesseract.js");
const eng = require("@tesseract.js-data/eng") as { langPath: string };

const DIR = path.join(process.cwd(), "tests/fixtures/qa-resumes-14");

interface QaResume {
    file: string;
    name: string;
    location: string;
    current_title: string;
    titles: string[];
    employers: string[];
    years_of_experience: number;
    skills: string[];
    expect_ocr: boolean;
}

const truth = JSON.parse(readFileSync(path.join(DIR, "ground_truth.json"), "utf8")) as { resumes: QaResume[] };

/** Repeated lines the long synthetic PDFs print under every job. */
const FILLER = [
    "Partnered with cross-functional leaders to set quarterly priorities and track outcomes",
    "Documented processes and trained new team members on standards and tools",
    "Presented progress and risks to senior leadership in monthly reviews",
    "Mentored junior colleagues and ran recurring knowledge-sharing sessions",
    "Identified process gaps and delivered improvements that reduced rework",
    "Built dashboards to track KPIs and shared weekly updates with stakeholders",
];

/** Bullets printed under each role, in order. Taken from the fixture text, not from the parser. */
const BULLETS: Record<string, string[][]> = {
    "01_nurse_priya_desai.pdf": [
        ["Triage 30+ patients per shift using CTAS", "Precept new graduate nurses", "Lead sepsis screening compliance audits"],
        ["Managed care for 6-patient assignments", "Administered IV and PO medications", "Coordinated discharge planning"],
    ],
    "02_accountant_marcus_chen.pdf": [
        ["Own month-end close for 4 entities", "Cut close cycle from 10 to 6 days", "Lead annual audit with external auditors"],
        ["Prepared balance sheet reconciliations", "Filed quarterly HST returns"],
        ["Performed substantive testing for mid-market clients"],
    ],
    "03_electrician_daniel_okafor_scanned.pdf": [
        ["Maintain PLC-controlled production lines", "Install and troubleshoot 600V motor controls"],
        ["Wired commercial buildings to OESC", "Led crews of 3 apprentices"],
        ["Completed 9,000-hour apprenticeship"],
    ],
    "04_teacher_sarah_mitchell.docx": [
        ["Teach 26 students across a combined grade", "Raised EQAO reading scores 12 points"],
        ["Covered Grade 3 and Grade 6 LTO assignments"],
    ],
    "05_logistics_lead_ahmed_hassan.txt": [
        ["Lead a 22-person shift team", "Improved pick accuracy to 99.6%"],
        ["Scheduled 40+ outbound loads daily"],
        ["Picked and packed e-commerce orders"],
    ],
    "06_paralegal_elena_rossi_twocol.pdf": [
        ["Draft pleadings and motion records", "Manage 60+ active litigation files", ...FILLER.slice(0, 2)],
        ["Prepared Small Claims documents", "Handled client intake", ...FILLER.slice(0, 2)],
    ],
    "07_newgrad_dev_jordan_lee_onepage.pdf": [
        ["Built React dashboards for internal ops", "Wrote REST endpoints in Node.js"],
        ["Added unit tests raising coverage to 80%"],
    ],
    "08_senior_pm_natalie_brooks_long.pdf": [
        ["Own merchant onboarding; grew activation 34%", "Lead 3 squads (25 people)", "Launched usage-based pricing", ...FILLER],
        ["Shipped self-serve reporting used by 4,000 accounts", "Ran 40+ A/B tests", ...FILLER],
        ["Owned mobile release train", ...FILLER],
        ["Gathered requirements for banking clients", ...FILLER],
    ],
    "09_software_engineer_wei_zhang.docx": [
        ["Designed order service handling 3k RPS", "Led migration to Kubernetes"],
        ["Built Kafka ingestion pipeline"],
        ["Maintained Django APIs"],
    ],
    "10_data_scientist_fatima_noor_twocol.pdf": [
        ["Built churn model lifting retention 6%", "Deployed models with Airflow", ...FILLER.slice(0, 2)],
        ["Forecast service demand with Prophet", ...FILLER.slice(0, 2)],
    ],
    "11_slp_hannah_kowalski_scanned.pdf": [
        ["Carry a caseload of 45 pediatric clients", "Run Hanen parent groups"],
        ["Assessed adults and children post-stroke and with delays"],
    ],
    "12_occupational_therapist_ravi_patel.docx": [
        ["Complete home safety and equipment assessments", "Prescribe mobility aids for 30+ clients"],
        ["Delivered upper-extremity rehab programs"],
    ],
    "13_psychologist_dr_amara_singh_long.pdf": [
        ["Supervise 8 clinicians and residents", "Lead trauma treatment program", ...FILLER],
        ["Delivered CBT and DBT groups", "Completed 200+ diagnostic assessments", ...FILLER],
        ["Completed CPA-accredited residency", ...FILLER],
    ],
    "14_truck_driver_az_kevin_murphy.txt": [
        ["Run Ontario-Texas cross-border lanes", "1.2M km accident-free"],
        ["Delivered refrigerated loads across Ontario and Quebec"],
    ],
};

function jpegs(pdf: Buffer): Buffer[] {
    const out: Buffer[] = [];
    let from = 0;
    const startMark = Buffer.from([0xff, 0xd8, 0xff]);
    const endMark = Buffer.from([0xff, 0xd9]);
    while (from < pdf.length) {
        const start = pdf.indexOf(startMark, from);
        if (start < 0) break;
        const end = pdf.indexOf(endMark, start + 3);
        if (end < 0) break;
        out.push(pdf.subarray(start, end + 2));
        from = end + 2;
    }
    return out;
}

const scannedText = new Map<string, string>();

before(async () => {
    const scans = truth.resumes.filter((row) => row.expect_ocr);
    if (scans.length === 0) return;
    const worker = await createWorker("eng", OEM.LSTM_ONLY, {
        langPath: eng.langPath,
        cachePath: path.join(os.tmpdir(), "tess-cache"),
    });
    try {
        for (const row of scans) {
            const images = jpegs(readFileSync(path.join(DIR, row.file)));
            assert.ok(images.length > 0, `${row.file} has no embedded scan image`);
            const pages: string[] = [];
            for (const img of images) {
                const { data } = await worker.recognize(img, {}, { text: true, blocks: true });
                const blocks = (data.blocks ?? []) as unknown as OcrBlock[];
                const height = blocks.reduce((max, block) => {
                    const lines = block.paragraphs.flatMap((p) => p.lines);
                    return Math.max(max, ...lines.map((line) => line.bbox.y1));
                }, 1);
                const laid = blocks.length > 0 ? ocrPageText(blocks, 1, height) : "";
                pages.push(laid || data.text || "");
            }
            scannedText.set(row.file, tidyOcrText(pages.join("\n\n")));
        }
    } finally {
        await worker.terminate();
    }
});

async function textOf(row: QaResume): Promise<string> {
    if (row.expect_ocr) return scannedText.get(row.file) ?? "";
    const file = path.join(DIR, row.file);
    if (row.file.endsWith(".txt")) return readFileSync(file, "utf8");
    if (row.file.endsWith(".docx")) return (await mammoth.extractRawText({ path: file })).value;
    const bytes = readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const extracted = await extractPDFTextInBrowser(buffer);
    assert.ok(extracted.text && extracted.text.trim().length >= 20, extracted.error ?? `${row.file} yielded no text`);
    return extracted.text;
}

describe("QA résumés: parse matches ground truth", () => {
    for (const row of truth.resumes) {
        it(row.file, async () => {
            const data = resumeDataFromPlainText(await textOf(row));
            const got = {
                name: data.profile.name,
                title: data.profile.profession,
                location: data.profile.location,
                years: data.profile.yearsOfExperience,
                titles: data.experience.map((entry) => entry.role),
                employers: data.experience.map((entry) => entry.company),
            };
            assert.deepEqual(got, {
                name: row.name,
                title: row.current_title,
                location: row.location,
                years: row.years_of_experience,
                titles: row.titles,
                employers: row.employers,
            });

            const skills = data.competencies.flatMap((category) => category.skills);
            const skillText = skills.join("\n");
            const expectedBullets = BULLETS[row.file];
            assert.ok(expectedBullets, `no bullet list for ${row.file}`);
            assert.equal(expectedBullets.length, row.titles.length);
            expectedBullets.forEach((bullets, index) => {
                const description = data.experience[index]?.description ?? "";
                for (const bullet of bullets) {
                    assert.ok(description.includes(bullet), `${row.file} role ${index} (${row.titles[index]}) is missing "${bullet}"\n${description}`);
                    assert.ok(!skillText.includes(bullet), `${row.file} put "${bullet}" in skills`);
                }
            });

            if (row.expect_ocr) {
                for (const skill of row.skills) assert.ok(skillText.includes(skill), `${row.file} skills missing "${skill}"\n${skillText}`);
            } else {
                assert.deepEqual(skills, row.skills);
            }
        });
    }
});
