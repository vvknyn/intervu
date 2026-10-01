import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildDescriptionBlocks,
    formatDescription,
    labelSegments,
    segmentDescription,
    type DescBlock,
} from "../../src/lib/jobs/format-description";
import { stripHtmlLikeIngest } from "../fixtures/job-descriptions/ingest-strip";
import { EXPEL_TAM_HTML, PROSE_HTML, SKILLS_HTML, WORKDAY_HTML } from "../fixtures/job-descriptions/postings";

const words = (s: string) => s.replace(/\s+/g, " ").trim();
const blockWords = (blocks: DescBlock[]) =>
    words(blocks.map((b) => (b.type === "list" ? (b.items ?? []).join(" ") : `${b.lead ? `${b.lead} ` : ""}${b.text ?? ""}`)).join(" "));

describe("description layout: ingest-shaped postings", () => {
    it("Expel TAM (Vivek's screenshot): titles become headings and duties/requirements become lists", () => {
        const blocks = formatDescription(stripHtmlLikeIngest(EXPEL_TAM_HTML));
        const headings = blocks.filter((b) => b.type === "heading").map((b) => b.text);
        assert.deepEqual(headings, ["About Expel", "What you’ll do", "What you should bring with you", "Compensation"]);
        const lists = blocks.filter((b) => b.type === "list");
        assert.equal(lists.length, 2);
        assert.equal(lists[0]!.items!.length, 5);
        assert.equal(lists[1]!.items!.length, 4);
        assert.match(lists[1]!.items![0]!, /^5\+ years of security industry experience/);
    });

    it("pay stays full-weight prose; equal-opportunity text and #LI tags turn to fine print", () => {
        const blocks = formatDescription(stripHtmlLikeIngest(EXPEL_TAM_HTML));
        const pay = blocks.find((b) => b.text?.includes("$150,000"));
        assert.equal(pay?.type, "para");
        assert.ok(!pay?.fine, "a salary range is never fine print");
        const eeo = blocks.find((b) => b.text?.includes("equal opportunity employer"));
        assert.equal(eeo?.fine, true);
        assert.equal(blocks.at(-1)?.text, "#LI-Remote");
        assert.equal(blocks.at(-1)?.fine, true);
    });

    it("Workday colon titles and <br> lines: heading + body, heading + list, bold label", () => {
        const blocks = formatDescription(stripHtmlLikeIngest(WORKDAY_HTML));
        assert.deepEqual(
            blocks.map((b) => b.type),
            ["heading", "para", "heading", "list", "para"],
        );
        assert.equal(blocks[0]!.text, "Position Summary");
        assert.deepEqual(blocks[3]!.items, [
            "Run onboarding for new accounts",
            "Lead quarterly business reviews",
            "Forecast renewals in Salesforce",
        ]);
        assert.equal(blocks[4]!.lead, "Location:");
        assert.equal(blocks[4]!.text, "Toronto, Ontario (Hybrid)");
    });

    it("short prose paragraphs under a heading stay paragraphs", () => {
        const blocks = formatDescription(stripHtmlLikeIngest(PROSE_HTML));
        assert.deepEqual(
            blocks.map((b) => b.type),
            ["heading", "para", "para", "para"],
        );
    });

    it("a bare skills list closes before a trailing prose sentence", () => {
        const blocks = formatDescription(stripHtmlLikeIngest(SKILLS_HTML));
        assert.deepEqual(blocks.map((b) => b.type), ["heading", "list", "para"]);
        assert.deepEqual(blocks[1]!.items, ["Python", "SQL", "dbt", "Snowflake"]);
    });

    it("never changes a word: every fixture's blocks read the same text as its lines", () => {
        for (const html of [EXPEL_TAM_HTML, WORKDAY_HTML, PROSE_HTML, SKILLS_HTML]) {
            const raw = stripHtmlLikeIngest(html);
            const segments = segmentDescription(raw);
            // Headings lose only a trailing colon.
            const expected = words(segments.map((s) => s.text).join(" ")).replace(/:(?= |$)/g, "");
            assert.equal(blockWords(formatDescription(raw)).replace(/:(?= |$)/g, ""), expected);
        }
    });

    it("marks guessed lines unsure and markup-backed lines sure", () => {
        const { labels, sure } = labelSegments(segmentDescription("Requirements:\n- Python\n- SQL\n\nWhat you should bring\n\nGrit\n\nCuriosity\n\nPatience"));
        assert.deepEqual(labels, ["H", "B", "B", "H", "B", "B", "B"]);
        assert.deepEqual(sure, [true, true, true, false, false, false, false]);
    });

    it("builds blocks from any label set without dropping lines", () => {
        const segments = segmentDescription("One\n\nTwo\n\nThree");
        const blocks = buildDescriptionBlocks(segments, ["H", "B", "B"]);
        assert.deepEqual(blocks, [
            { type: "heading", text: "One" },
            { type: "list", items: ["Two", "Three"] },
        ]);
    });
});
