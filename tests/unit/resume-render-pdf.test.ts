import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";

import { parseResumeContent, resumeDataToParsedDocument, type ParsedResumeDocument } from "@/lib/resume/parse-resume-content";
import { descriptionToBullets, mergeResumeBulletLines } from "@/lib/resume/merge-bullet-lines";
import { structureResumeText } from "@/lib/resume/structure-resume-text";
import {
  layoutResumeDocument,
  deriveResumePdfFilename,
  DEFAULT_PAGE_METRICS,
  DESCENT_PAD,
  RESUME_PDF_TYPOGRAPHY,
  jsPdfMeasurer,
  renderResumePdf,
  type TextMeasurer,
} from "@/lib/resume/render-pdf";
import type { ResumeData } from "@/types/resume";

const PM_FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-pm-resume.txt"), "utf8");
const CSM_GOLDEN_FIXTURE = readFileSync(path.join(process.cwd(), "tests/fixtures/vivek-csm-golden-resume.txt"), "utf8");

/** Mirrors render-pdf.ts's internal BODY_SIZE — not exported (an internal
 *  tuning constant, not public API), so gap-math assertions here recompute
 *  expected widths against the SAME fakeMeasurer using this literal. */
const BODY_SIZE_FOR_TESTS = 9;

const LETTER_SPACED_RE = /\b(?:[A-Za-z]\s){3,}[A-Za-z]\b/;

/** Deterministic fake measurer — monospace approximation, no jsPDF/canvas
 *  dependency, so layout tests run fast and don't depend on font-metric
 *  drift. Wraps greedily on word boundaries, same contract as jsPDF's
 *  splitTextToSize. */
const fakeMeasurer: TextMeasurer = {
  widthOf: (text, size) => text.length * size * 0.5,
  wrap: (text, maxWidth, size) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length * size * 0.5 > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  },
};

/* --------------------------------- parseResumeContent --------------------------------- */

describe("parseResumeContent", () => {
  it("extracts name, contact line, and sections in source order", () => {
    const content = [
      "Vivek Narayanan",
      "Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com",
      "PROFESSIONAL SUMMARY",
      "Senior PM with 10+ years.",
      "CORE COMPETENCIES",
      "**Product:** Roadmapping, Discovery, A/B Testing",
      "PROFESSIONAL EXPERIENCE",
      "**Product Manager | Acme**    September '21 — Present",
      "- Shipped the thing",
      "- Led the team",
    ].join("\n");
    const doc = parseResumeContent(content);
    assert.equal(doc.name, "Vivek Narayanan");
    assert.equal(doc.contactLine, "Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com");
    assert.deepEqual(
      doc.sections.map((s) => s.heading),
      ["PROFESSIONAL SUMMARY", "CORE COMPETENCIES", "PROFESSIONAL EXPERIENCE"],
    );
    const exp = doc.sections[2].blocks[0];
    assert.equal(exp.kind, "entry");
    assert.ok(exp.kind === "entry" && exp.title === "Product Manager | Acme");
    assert.ok(exp.kind === "entry" && exp.dateRight === "September '21 — Present");
    assert.ok(exp.kind === "entry" && exp.bullets.length === 2);
  });

  it("parses a bold competency line into category + items", () => {
    const doc = parseResumeContent("Jane Doe\njane@example.com\nSKILLS\n**Languages:** TypeScript, Python, Go");
    const block = doc.sections[0].blocks[0];
    assert.equal(block.kind, "competency");
    assert.ok(block.kind === "competency" && block.category === "Languages");
    assert.ok(block.kind === "competency" && block.items === "TypeScript, Python, Go");
  });

  it("collapses consecutive plain lines into one paragraph, resets on blank line", () => {
    const doc = parseResumeContent("Jane Doe\njane@example.com\nSUMMARY\nLine one.\nLine two continues.\n\nA new paragraph.");
    const blocks = doc.sections[0].blocks;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].kind, "paragraph");
    assert.ok(blocks[0].kind === "paragraph" && blocks[0].text === "Line one. Line two continues.");
    assert.ok(blocks[1].kind === "paragraph" && blocks[1].text === "A new paragraph.");
  });

  it("empty content produces no sections and no crash", () => {
    const doc = parseResumeContent("");
    assert.equal(doc.name, null);
    assert.equal(doc.contactLine, null);
    assert.deepEqual(doc.sections, []);
  });

  it("content with no recognizable section headers at all still parses without crashing — everything lands in one fallback section, nothing dropped", () => {
    const doc = parseResumeContent("Jane Doe\njane@example.com\nNo headers here, just prose that keeps going without any section label at all.");
    assert.equal(doc.sections.length, 1);
    assert.equal(doc.sections[0].heading, "");
    assert.ok(doc.sections[0].blocks[0].kind === "paragraph" && doc.sections[0].blocks[0].text.includes("prose that keeps going"));
  });

  it("a two-line-only document (name + contact, nothing else) never crashes and produces zero sections rather than fabricating one", () => {
    const doc = parseResumeContent("Jane Doe\njane@example.com");
    assert.equal(doc.name, "Jane Doe");
    assert.equal(doc.contactLine, "jane@example.com");
    assert.deepEqual(doc.sections, []);
  });

  it("survives special characters and unicode without crashing or dropping content", () => {
    const content = "José García\ncontact@example.com — 日本語 — émigré\nSUMMARY\nBuilt things with 100% ROI & <3 for users — “quoted”.";
    const doc = parseResumeContent(content);
    assert.equal(doc.name, "José García");
    assert.ok(doc.sections[0].blocks[0].kind === "paragraph");
    assert.ok(doc.sections[0].blocks[0].kind === "paragraph" && doc.sections[0].blocks[0].text.includes("100% ROI"));
  });

  it("markdown ATX headings (## Section) are recognized the same as a bare ALL-CAPS line", () => {
    const doc = parseResumeContent("Name\njane@example.com\n## Education\n- BSc CS | MIT");
    assert.equal(doc.sections[0].heading, "EDUCATION");
  });
});

/* --------------------------------- resumeDataToParsedDocument --------------------------------- */

function blankResumeData(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    profile: { name: "", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "" },
    experience: [],
    competencies: [],
    education: [],
    generatedSummary: "",
    ...overrides,
  };
}

describe("resumeDataToParsedDocument", () => {
  it("maps every populated section into the same ParsedResumeDocument shape a free-text variant parses into", () => {
    const data = blankResumeData({
      profile: { name: "Ada Lovelace", profession: "Engineer", yearsOfExperience: 5, location: "Remote", email: "ada@x.com", phone: "555", linkedin: "in/ada" },
      generatedSummary: "Experienced engineer.",
      competencies: [{ category: "Languages", skills: ["TS", "Python"] }],
      experience: [{ id: "e1", company: "Acme", role: "Engineer", dates: "2020-Present", description: "- Did a thing\n- Did another" }],
      education: [{ id: "ed1", degree: "BSc CS", institution: "MIT", year: "2016" }],
    });
    const doc = resumeDataToParsedDocument(data);
    assert.equal(doc.name, "Ada Lovelace");
    assert.deepEqual(
      doc.sections.map((s) => s.heading),
      ["PROFESSIONAL SUMMARY", "CORE COMPETENCIES", "PROFESSIONAL EXPERIENCE", "EDUCATION & PROFESSIONAL DEVELOPMENT"],
    );
    const exp = doc.sections[2].blocks[0];
    assert.ok(exp.kind === "entry" && exp.title === "Engineer | Acme" && exp.bullets.length === 2);
  });

  it("an entirely blank ResumeData produces zero sections and no crash", () => {
    const doc = resumeDataToParsedDocument(blankResumeData());
    assert.deepEqual(doc.sections, []);
    assert.equal(doc.contactLine, null);
  });
});

/* --------------------------------- layoutResumeDocument --------------------------------- */

const SAMPLE_DOC: ParsedResumeDocument = {
  name: "Vivek Narayanan",
  contactLine: "Richmond Hill | viveknyan@gmail.com",
  sections: [
    { heading: "PROFESSIONAL SUMMARY", blocks: [{ kind: "paragraph", text: "Senior PM with a decade of experience." }] },
    {
      heading: "PROFESSIONAL EXPERIENCE",
      blocks: [{ kind: "entry", title: "Product Manager | Acme", dateRight: "September '21 — Present", bullets: ["Shipped the thing.", "Led the team."] }],
    },
  ],
};

describe("layoutResumeDocument — header centering", () => {
  it("centers the name and contact line on the page's horizontal midpoint", () => {
    const layout = layoutResumeDocument(SAMPLE_DOC, fakeMeasurer);
    const nameCmd = layout.pages[0].texts.find((t) => t.text === "Vivek Narayanan");
    assert.ok(nameCmd);
    assert.equal(nameCmd!.align, "center");
    assert.equal(nameCmd!.x, DEFAULT_PAGE_METRICS.pageWidth / 2);
    const contactCmd = layout.pages[0].texts.find((t) => t.text === SAMPLE_DOC.contactLine);
    assert.ok(contactCmd);
    assert.equal(contactCmd!.align, "center");
  });

  it("section headers are left-aligned, bold, and each pairs with a full-width rule beneath it", () => {
    const layout = layoutResumeDocument(SAMPLE_DOC, fakeMeasurer);
    const headingCmd = layout.pages[0].texts.find((t) => t.text === "PROFESSIONAL SUMMARY");
    assert.ok(headingCmd);
    assert.equal(headingCmd!.align, "left");
    assert.equal(headingCmd!.bold, true);
    assert.equal(layout.pages[0].rules.length, 2, "one rule per section heading (Summary + Experience)");
  });
});

describe("layoutResumeDocument — section order preserved", () => {
  it("draw commands for each section's content appear in the SAME order the parsed sections were given", () => {
    const layout = layoutResumeDocument(SAMPLE_DOC, fakeMeasurer);
    const order = layout.pages
      .flatMap((p) => p.texts)
      .map((t) => t.text)
      .filter((t) => t === "PROFESSIONAL SUMMARY" || t === "PROFESSIONAL EXPERIENCE" || t === "Product Manager | Acme");
    assert.deepEqual(order, ["PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "Product Manager | Acme"]);
  });
});

describe("layoutResumeDocument — date right-alignment", () => {
  it("an experience entry's date renders as its own right-aligned command at the page's right margin", () => {
    const layout = layoutResumeDocument(SAMPLE_DOC, fakeMeasurer);
    const dateCmd = layout.pages[0].texts.find((t) => /September '21/.test(t.text) && /Present/.test(t.text));
    assert.ok(dateCmd, "date must be its own draw command, not glued to the title text");
    assert.equal(dateCmd!.align, "right");
    assert.equal(dateCmd!.x, DEFAULT_PAGE_METRICS.pageWidth - DEFAULT_PAGE_METRICS.marginX);
  });

  it("an entry with no date at all renders the title with no stray right-aligned command", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "entry", title: "Volunteer | Acme", dateRight: null, bullets: [] }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.equal(layout.pages[0].texts.filter((t) => t.align === "right").length, 0);
  });
});

describe("layoutResumeDocument — long-content pagination", () => {
  it("a bullet list long enough to overflow one page spills onto additional pages; each bullet's dot stays on the same page as its first line (continuation lines may continue on the next page)", () => {
    const manyBullets = Array.from({ length: 80 }, (_, i) => `Bullet number ${i} describing an accomplishment in enough detail to wrap across a couple of lines when rendered.`);
    const doc: ParsedResumeDocument = {
      name: "Long Resume",
      contactLine: null,
      sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: manyBullets }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(layout.pages.length > 1, "80 wrapping bullets must overflow a single US-Letter page");

    // Each bullet is one DrawDot (see DrawDot's doc — never a "●" text
    // glyph) paired with its first line on the SAME page. Multi-line
    // bullets may continue on the next page, but the dot always stays with
    // line 1 — never orphaned on a prior page without its text.
    let totalDots = 0;
    for (const page of layout.pages) {
      totalDots += page.dots.length;
      for (const dot of page.dots) {
        const paired = page.texts.some((t) => Math.abs(t.y - (dot.y + BODY_SIZE_FOR_TESTS * 0.32)) < 0.01);
        assert.ok(paired, `dot at y=${dot.y} must have its bullet's first line of text on the SAME page`);
      }
    }
    assert.equal(totalDots, 80, "every bullet must produce exactly one dot across all pages");
  });

  it("a single entry's title+dates+bullets group never has its title stranded alone at the bottom of a page", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [
        {
          heading: "EXPERIENCE",
          blocks: Array.from({ length: 20 }, (_, i) => ({
            kind: "entry" as const,
            title: `Role ${i} | Company ${i}`,
            dateRight: "2020 — 2021",
            bullets: ["One accomplishment.", "Another accomplishment."],
          })),
        },
      ],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(layout.pages.length > 1);
    // Every "Role N | Company N" title command is immediately followed
    // (within the same page) by its date — proves the title line itself is
    // never split mid-render across the reserve() boundary.
    for (const page of layout.pages) {
      const titleIdxs = page.texts.map((t, i) => (/^Role \d+ \| Company \d+$/.test(t.text) ? i : -1)).filter((i) => i >= 0);
      for (const idx of titleIdxs) {
        const next = page.texts[idx + 1];
        assert.ok(next && /^2020/.test(next.text), "title and its date must render on the same page");
      }
    }
  });
});

/* --------------------------------- deriveResumePdfFilename --------------------------------- */

describe("deriveResumePdfFilename", () => {
  it("company + role -> <Company>-<Role>-resume-<date> (the founder's reference convention)", () => {
    assert.equal(
      deriveResumePdfFilename({ company: "Indigo", role: "Digital Product Manager", dateIso: "2026-08-07T00:00:00.000Z" }),
      "Indigo-Digital-Product-Manager-resume-2026-08-07",
    );
  });

  it("missing role falls back to company alone", () => {
    assert.equal(deriveResumePdfFilename({ company: "Indigo", role: null, dateIso: "2026-08-07T00:00:00.000Z" }), "Indigo-resume-2026-08-07");
  });

  it("missing company AND role falls back to the version's own label, then to a generic stem — never empty or broken", () => {
    assert.equal(
      deriveResumePdfFilename({ company: null, role: null, fallbackLabel: "tailored for Acme", dateIso: "2026-08-07T00:00:00.000Z" }),
      "tailored-for-Acme-resume-2026-08-07",
    );
    assert.equal(deriveResumePdfFilename({ company: null, role: null, dateIso: "2026-08-07T00:00:00.000Z" }), "resume-resume-2026-08-07");
  });

  it("sanitizes punctuation/spaces in company and role into filename-safe hyphens", () => {
    const name = deriveResumePdfFilename({ company: "Acme, Inc.", role: "Sr. PM (Growth)", dateIso: "2026-01-05T00:00:00.000Z" });
    assert.ok(/^[\w.-]+$/.test(name), `expected a filename-safe stem, got "${name}"`);
  });
});

/* --------------------------------- fix round: markdown vs plain-text, class case --------------------------------- *
 * Visual verification (coordinator, 2026-08-09) caught `isSectionHeader`
 * treating EVERY markdown heading level the same: `# Name` became a ruled
 * "NAME" section, and `### Title | Company | Dates` became a ruled
 * ALL-CAPS section instead of an experience entry. Fixed by making the
 * parser LEVEL-aware (H1 -> name, H2 -> section, H3+ -> entry). Both input
 * shapes an LLM-saved variant can arrive in — markdown (the actual cause of
 * the user's bug report) and the plain-text/ALL-CAPS shape the founder's
 * own reference PDF's extracted text uses — must produce the SAME
 * structure; neither is a second, divergent path.
 */

describe("parseResumeContent — markdown heading levels (class case: name/H1, section/H2, entry/H3+)", () => {
  it("H1 is captured as the NAME, never a section — the exact bug: '# Vivek Narayanan' used to become a ruled 'VIVEK NARAYANAN' section", () => {
    const doc = parseResumeContent("# Vivek Narayanan\nRichmond Hill, Ontario | viveknyan@gmail.com\n## SUMMARY\nBody text.");
    assert.equal(doc.name, "Vivek Narayanan");
    assert.equal(doc.contactLine, "Richmond Hill, Ontario | viveknyan@gmail.com");
    assert.deepEqual(doc.sections.map((s) => s.heading), ["SUMMARY"]);
  });

  it("H2 is a section header, uppercased, same as the ALL-CAPS plain-text convention", () => {
    const doc = parseResumeContent("Name\njane@example.com\n## Professional Summary\nBody.");
    assert.deepEqual(doc.sections.map((s) => s.heading), ["PROFESSIONAL SUMMARY"]);
  });

  it("H3 is an EXPERIENCE ENTRY, never a section — the exact bug: '### Title | Company | Dates' used to become a ruled ALL-CAPS section", () => {
    const doc = parseResumeContent(
      "Name\njane@example.com\n## PROFESSIONAL EXPERIENCE\n### Client-facing Product Manager | TELUS Health Wellbeing | September '21 — Present\n- Did the thing.",
    );
    assert.equal(doc.sections.length, 1, "the H3 line must NOT open a second section");
    const entry = doc.sections[0].blocks[0];
    assert.equal(entry.kind, "entry");
    assert.ok(entry.kind === "entry" && entry.title === "Client-facing Product Manager | TELUS Health Wellbeing", `got title ${entry.kind === "entry" ? entry.title : ""}`);
    assert.ok(entry.kind === "entry" && entry.dateRight === "September '21 — Present");
    assert.ok(entry.kind === "entry" && entry.bullets.length === 1);
  });

  it("H4 is ALSO an entry (not just H3) — the level rule is >= 3, not a single hardcoded level", () => {
    const doc = parseResumeContent("Name\njane@example.com\n## EXPERIENCE\n#### Engineer | Acme | 2020 — 2022\n- Shipped things.");
    const entry = doc.sections[0].blocks[0];
    assert.equal(entry.kind, "entry");
    assert.ok(entry.kind === "entry" && entry.dateRight === "2020 — 2022");
  });

  it("an entry heading with NO date-ish trailing segment keeps the whole text as the title, dateRight null — degrades gracefully, never crashes", () => {
    const doc = parseResumeContent("Name\njane@example.com\n## EXPERIENCE\n### Volunteer Work\n- Helped out.");
    const entry = doc.sections[0].blocks[0];
    assert.ok(entry.kind === "entry" && entry.title === "Volunteer Work" && entry.dateRight === null);
  });

  it("splits on the LAST separator, not the first — 'Title | Company | Dates' keeps 'Title | Company' intact as one title", () => {
    const doc = parseResumeContent("Name\njane@example.com\n## EXPERIENCE\n### Senior Engineer | Acme Corp | 2020 — Present\n- Bullet.");
    const entry = doc.sections[0].blocks[0];
    assert.ok(entry.kind === "entry" && entry.title === "Senior Engineer | Acme Corp");
  });
});

describe("parseResumeContent — plain-text shape produces the SAME structure (class case, both shapes covered)", () => {
  it("unadorned name line + ALL-CAPS section + a two-space-gap dated entry line all resolve identically to the markdown shape", () => {
    const doc = parseResumeContent(
      "Vivek Narayanan\nRichmond Hill, Ontario | viveknyan@gmail.com\nPROFESSIONAL EXPERIENCE\nClient-facing Product Manager | TELUS Health Wellbeing    September '21 — Present\n- Did the thing.",
    );
    assert.equal(doc.name, "Vivek Narayanan");
    assert.deepEqual(doc.sections.map((s) => s.heading), ["PROFESSIONAL EXPERIENCE"]);
    const entry = doc.sections[0].blocks[0];
    assert.equal(entry.kind, "entry");
    assert.ok(entry.kind === "entry" && entry.title === "Client-facing Product Manager | TELUS Health Wellbeing");
    assert.ok(entry.kind === "entry" && entry.dateRight === "September '21 — Present");
  });

  it("class case: an apostrophe'd 2-digit year range with no 'Present' ('July '19 — February '20', the founder's own reference resume's convention for a past role) still resolves as a dated entry", () => {
    const doc = parseResumeContent("Name\njane@example.com\nEXPERIENCE\nTechnology Lead | Tracxn Technologies    July '19 — February '20\n- Led a team.");
    const entry = doc.sections[0].blocks[0];
    assert.equal(entry.kind, "entry");
    assert.ok(entry.kind === "entry" && entry.dateRight === "July '19 — February '20");
  });
});

describe("render-pdf — fix round: bullet glyph, rule position, competency spacing", () => {
  it("a bullet is drawn as a filled circle (DrawDot), never as bullet TEXT — the mojibake bug ('●'/'•' have no WinAnsi codepoint in jsPDF's core fonts)", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: ["One thing."] }] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const allText = layout.pages.flatMap((p) => p.texts).map((t) => t.text);
    assert.ok(!allText.some((t) => t === "●" || t === "•"), `no draw-text command should be a bullet glyph, got ${JSON.stringify(allText)}`);
    assert.equal(layout.pages[0].dots.length, 1, "exactly one dot per bullet item");
  });

  it("a section header's rule sits BELOW the text's full line box, never through it — the struck-through-text bug", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [{ kind: "paragraph", text: "Body." }] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const headingCmd = layout.pages[0].texts.find((t) => t.text === "SUMMARY")!;
    const rule = layout.pages[0].rules[0];
    // headingCmd.y is the text BASELINE; a 10pt heading's full line box
    // (lh = 10 * 1.35 = 13.5) must fully clear the baseline before the rule
    // — i.e. the rule sits at least (lineHeight - the 0.8 baseline offset
    // already spent) below the baseline, never within a few points of it.
    assert.ok(rule.y - headingCmd.y >= 5, `rule (y=${rule.y}) must sit well clear of the heading text's baseline (y=${headingCmd.y}), not strike through it`);
  });

  it("a competency line's first wrapped line is bold label + one remainder string (not per-word draws)", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [{ heading: "SKILLS", blocks: [{ kind: "competency", category: "Data, Analytics & Technical", items: "SQL, Python, Go, Rust, Java, C, Kotlin" }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const texts = layout.pages[0].texts;
    const boldRun = texts.find((t) => t.bold && t.text === "Data, Analytics & Technical:")!;
    assert.ok(boldRun, "expected a bold draw command for the category label");
    const sameLine = texts.filter((t) => t.y === boldRun.y);
    assert.equal(sameLine.length, 2, "first competency line must be exactly two draw commands (label + remainder)");
    const remainder = sameLine.find((t) => !t.bold)!;
    assert.ok(remainder.text.startsWith("SQL"), "remainder must be one string starting with first skill");
    const labelEndX = boldRun.x + fakeMeasurer.widthOf(boldRun.text, BODY_SIZE_FOR_TESTS, true);
    assert.ok(remainder.x - labelEndX >= 1, "label and remainder must have a positive x-gap");
  });

  it("class test: two labels of different lengths both use bold label + single remainder on line 1", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [
        {
          heading: "SKILLS",
          blocks: [
            { kind: "competency", category: "AI", items: "TensorFlow, PyTorch, one, two, three, four, five, six, seven, eight" },
            { kind: "competency", category: "Data, Analytics & Technical Systems Engineering", items: "SQL, Python, one, two, three, four, five, six, seven" },
          ],
        },
      ],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    for (const label of ["AI:", "Data, Analytics & Technical Systems Engineering:"]) {
      const boldRun = layout.pages[0].texts.find((t) => t.bold && t.text === label)!;
      assert.ok(boldRun, `expected a bold draw command for "${label}"`);
      const sameLine = layout.pages[0].texts.filter((t) => t.y === boldRun.y);
      assert.equal(sameLine.length, 2, `"${label}" first line must be label + remainder only`);
    }
  });

  it("competency continuation lines are single draw commands, not per-word", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [
        {
          heading: "SKILLS",
          blocks: [
            {
              kind: "competency",
              category: "Data",
              items: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree",
            },
          ],
        },
      ],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const labelCmd = layout.pages[0].texts.find((t) => t.text === "Data:")!;
    assert.ok(labelCmd);
    const firstLine = layout.pages[0].texts.filter((t) => t.y === labelCmd.y);
    assert.equal(firstLine.length, 2, "first line: label + remainder");
    const continuationLines = new Map<number, typeof layout.pages[0]["texts"]>();
    for (const t of layout.pages.flatMap((p) => p.texts)) {
      if (t.y === labelCmd.y) continue;
      if (!continuationLines.has(t.y)) continuationLines.set(t.y, []);
      continuationLines.get(t.y)!.push(t);
    }
    for (const [, line] of continuationLines) {
      assert.equal(line.length, 1, "continuation lines must be one draw command each");
    }
  });
});

describe("render-pdf — ragged body text (left-aligned, natural word spacing)", () => {
  const LONG_PARAGRAPH = { kind: "paragraph" as const, text: Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ") };
  const rightEdge = DEFAULT_PAGE_METRICS.pageWidth - DEFAULT_PAGE_METRICS.marginX;
  const naturalSpace = fakeMeasurer.widthOf(" ", BODY_SIZE_FOR_TESTS, false);

  function wordLines(layout: ReturnType<typeof layoutResumeDocument>) {
    const byLine = new Map<number, typeof layout.pages[0]["texts"]>();
    for (const t of layout.pages.flatMap((p) => p.texts)) {
      if (!byLine.has(t.y)) byLine.set(t.y, []);
      byLine.get(t.y)!.push(t);
    }
    return [...byLine.values()].filter((l) => l.some((t) => t.text.startsWith("word")));
  }

  it("non-last wrapped paragraph lines draw as a single text command (native word spacing), not per-word stretched justify", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [LONG_PARAGRAPH] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const lines = wordLines(layout);
    assert.ok(lines.length >= 2, "the fixture must wrap to multiple lines");
    for (const line of lines.slice(0, -1)) {
      assert.equal(line.length, 1, "ragged paragraph lines must be one draw command, not per-word stretched positioning");
      const cmd = line[0];
      const naturalEndX = cmd.x + fakeMeasurer.widthOf(cmd.text, BODY_SIZE_FOR_TESTS, false);
      assert.ok(Math.abs(naturalEndX - rightEdge) >= 1 || naturalEndX <= rightEdge - 1, "line end must follow natural width, not forced justify to the right edge");
    }
  });

  it("paragraph lines are not stretched to the right edge within justify tolerance (≤3pt)", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [LONG_PARAGRAPH] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const lines = wordLines(layout);
    assert.ok(lines.length >= 2);
    let sawClearlyRagged = false;
    for (const line of lines.slice(0, -1)) {
      const cmd = line[0];
      const endX = cmd.x + fakeMeasurer.widthOf(cmd.text, BODY_SIZE_FOR_TESTS, false);
      if (Math.abs(endX - rightEdge) > 3) sawClearlyRagged = true;
    }
    assert.ok(sawClearlyRagged || lines.slice(0, -1).every((l) => l.length === 1), "at least one non-last line must not be justify-snapped to the right edge, or all are single-command ragged");
  });

  it("a bullet's non-last wrapped lines are also ragged, not stretched to the right edge", () => {
    const longBullet = "word0 word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12 word13 word14 word15 word16 word17 word18 word19 word20 word21 word22 word23 word24 word25 word26 word27 word28";
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: [longBullet] }] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const lines = wordLines(layout);
    assert.ok(lines.length >= 2, "the fixture bullet must wrap to multiple lines");
    const first = lines[0].reduce((a, b) => (a.x > b.x ? a : b));
    const firstEndX = first.x + fakeMeasurer.widthOf(first.text, BODY_SIZE_FOR_TESTS, false);
    assert.ok(firstEndX <= rightEdge, "a bullet's non-last line must not extend past the right margin");
    assert.ok(firstEndX < rightEdge || lines[0].length === 1, "a bullet's non-last line is one ragged draw command");
  });

  it("a competency block's first line has exactly two draw commands (bold label + remainder)", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [{ heading: "SKILLS", blocks: [{ kind: "competency", category: "Data", items: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty" }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const labelCmd = layout.pages[0].texts.find((t) => t.text === "Data:")!;
    assert.ok(labelCmd);
    const firstLine = layout.pages[0].texts.filter((t) => t.y === labelCmd.y);
    assert.equal(firstLine.length, 2);
    assert.ok(firstLine.some((t) => t.bold && t.text === "Data:"));
    assert.ok(firstLine.some((t) => !t.bold && t.text.startsWith("one")));
  });

  it("a single-word line (nothing to distribute) never crashes and stays at its natural width", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [{ kind: "paragraph", text: "Solo" }] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const cmd = layout.pages[0].texts.find((t) => t.text === "Solo");
    assert.ok(cmd);
  });
});

describe("render-pdf — pagination bounds and content preservation", () => {
  const maxDrawY = DEFAULT_PAGE_METRICS.pageHeight - DEFAULT_PAGE_METRICS.marginBottom - DESCENT_PAD;
  const minDrawY = DEFAULT_PAGE_METRICS.marginTop;

  function assertAllDrawCommandsInBounds(layout: ReturnType<typeof layoutResumeDocument>) {
    for (const page of layout.pages) {
      for (const t of page.texts) {
        assert.ok(t.y >= minDrawY, `text y=${t.y} above top margin`);
        assert.ok(t.y <= maxDrawY, `text y=${t.y} past bottom margin (max=${maxDrawY})`);
      }
      for (const d of page.dots) {
        assert.ok(d.y >= minDrawY, `dot y=${d.y} above top margin`);
        assert.ok(d.y <= maxDrawY, `dot y=${d.y} past bottom margin (max=${maxDrawY})`);
      }
    }
  }

  it("content filling past one US-Letter page keeps every draw command within margins and preserves all bullet words", () => {
    const manyBullets = Array.from({ length: 80 }, (_, i) => `Bullet number ${i} describing an accomplishment in enough detail to wrap across a couple of lines when rendered.`);
    const doc: ParsedResumeDocument = {
      name: "Long Resume",
      contactLine: null,
      sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: manyBullets }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(layout.pages.length > 1);
    assertAllDrawCommandsInBounds(layout);

    const drawnWords = new Set(layout.pages.flatMap((p) => p.texts).flatMap((t) => t.text.split(/\s+/)));
    for (let i = 0; i < 80; i++) {
      assert.ok(drawnWords.has(`Bullet`), `bullet ${i} content must appear in draw commands`);
      assert.ok(drawnWords.has(`${i}`), `bullet ${i} number must appear in draw commands`);
    }
  });

  it("short one-line bullets packed to the page bottom stay within DESCENT_PAD — reserveLine uses drawn baseline, not line-box height", () => {
    const items = Array.from({ length: 75 }, (_, i) => `Item ${i}.`);
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items }] }],
    };
    let layout: ReturnType<typeof layoutResumeDocument>;
    assert.doesNotThrow(() => {
      layout = layoutResumeDocument(doc, fakeMeasurer);
    });
    assertAllDrawCommandsInBounds(layout!);

    const page1MaxDraw = Math.max(
      0,
      ...layout!.pages[0].texts.map((t) => t.y),
      ...layout!.pages[0].dots.map((d) => d.y),
    );
    assert.ok(
      page1MaxDraw >= maxDrawY - 15,
      `fixture should pack page 1 near the bottom (max draw y=${page1MaxDraw}, limit=${maxDrawY})`,
    );
    assert.ok(page1MaxDraw <= maxDrawY, "page 1 must respect DESCENT_PAD clearance");
  });

  it("a multi-line bullet either moves entirely to the next page or splits at line boundaries — no line draws past maxY", () => {
    const longBullet = Array.from({ length: 30 }, (_, i) => `token${i}`).join(" ");
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [
        {
          heading: "EXPERIENCE",
          blocks: [
            {
              kind: "bullets",
              items: [
                ...Array.from({ length: 70 }, (_, i) => `Short filler bullet number ${i} with a few words.`),
                longBullet,
              ],
            },
          ],
        },
      ],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(layout.pages.length >= 2);
    assertAllDrawCommandsInBounds(layout);

    const tokenTexts = layout.pages.flatMap((p) => p.texts).filter((t) => t.text.startsWith("token"));
    assert.ok(tokenTexts.length >= 2, "long bullet must wrap to multiple draw lines");
    for (const t of tokenTexts) {
      assert.ok(t.y <= maxDrawY, `continuation line y=${t.y} must not exceed bottom margin`);
    }
  });
});

/* --------------------------------- bullet line merge --------------------------------- */

const WRAPPED_MSA_LINES = [
  "- Owned the client-facing product roadmap for the Medibank wellbeing platform under a 3-year,",
  "multi-million-dollar MSA — translating client strategy into scoped, estimated, and",
  "prioritized SOWs across a $1.7M ARR, 2-account portfolio.",
];

const WRAPPED_TELUS_SNIPPET = [
  "Vivek Narayanan",
  "Richmond Hill, Ontario | viveknyan@gmail.com",
  "PROFESSIONAL EXPERIENCE",
  "Client-facing Product Manager | TELUS Health Wellbeing    September '21 — Present",
  ...WRAPPED_MSA_LINES,
].join("\n");

describe("mergeResumeBulletLines — wrap continuation", () => {
  it("merges a 3-line soft-wrapped MSA bullet into exactly one item", () => {
    const merged = mergeResumeBulletLines(WRAPPED_MSA_LINES);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].includes("translating client strategy"));
    assert.ok(merged[0].includes("prioritized SOWs"));
    assert.ok(!merged.some((b) => b.startsWith("multi-million")));
  });

  it("descriptionToBullets matches mergeResumeBulletLines on newline-joined input", () => {
    const bullets = descriptionToBullets(WRAPPED_MSA_LINES.join("\n"));
    assert.equal(bullets.length, 1);
    assert.ok(bullets[0].includes("translating client strategy"));
  });
});

describe("structure → parse → PDF — wrapped TELUS MSA bullet", () => {
  it("structureResumeText + resumeDataToParsedDocument yields one MSA bullet", () => {
    const structured = structureResumeText(WRAPPED_TELUS_SNIPPET);
    const telus = structured.experience.find((e) => /telus/i.test(e.company));
    assert.ok(telus, "TELUS entry missing");
    const bullets = descriptionToBullets(telus!.description);
    const msa = bullets.find((b) => /MSA/i.test(b));
    assert.ok(msa, "MSA bullet missing");
    assert.ok(msa!.includes("translating client strategy"));

    const doc = resumeDataToParsedDocument({
      profile: { name: structured.profile.name ?? "", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "" },
      experience: structured.experience.map((e, i) => ({ ...e, id: `e${i}` })),
      competencies: [],
      education: [],
      generatedSummary: "",
    });
    const entry = doc.sections.find((s) => s.heading === "PROFESSIONAL EXPERIENCE")!.blocks[0];
    assert.ok(entry.kind === "entry");
    const msaParsed = entry.bullets.find((b) => /MSA/i.test(b));
    assert.ok(msaParsed?.includes("translating client strategy"));
    assert.equal(entry.bullets.filter((b) => /multi-million/i.test(b)).length, 1);
  });

  it("layout produces exactly one DrawDot for the MSA bullet with 2+ wrapped text lines (fake measurer)", () => {
    const structured = structureResumeText(WRAPPED_TELUS_SNIPPET);
    const doc = resumeDataToParsedDocument({
      profile: { name: "Vivek Narayanan", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "" },
      experience: structured.experience.map((e, i) => ({ ...e, id: `e${i}` })),
      competencies: [],
      education: [],
      generatedSummary: "",
    });
    const entry = doc.sections.find((s) => s.heading === "PROFESSIONAL EXPERIENCE")!.blocks[0];
    assert.ok(entry.kind === "entry" && entry.bullets.length === 1);

    const layout = layoutResumeDocument(doc, fakeMeasurer);
    const allDots = layout.pages.flatMap((p) => p.dots);
    assert.equal(allDots.length, 1, "single bullet entry must produce exactly one dot");

    const joined = layout.pages.flatMap((p) => p.texts).map((t) => t.text).join(" ");
    assert.ok(joined.includes("translating client strategy"));
    assert.ok(joined.includes("prioritized SOWs"));

    const bulletIndent = DEFAULT_PAGE_METRICS.marginX + 12;
    const msaLines = layout.pages
      .flatMap((p) => p.texts)
      .filter(
        (t) =>
          t.x >= bulletIndent - 1 &&
          (/Owned the client-facing/i.test(t.text) ||
            /multi-million/i.test(t.text) ||
            /translating client strategy/i.test(t.text) ||
            /prioritized SOWs/i.test(t.text)),
      );
    assert.ok(msaLines.length >= 2, "MSA bullet must wrap to 2+ draw lines");

    const firstLineY = Math.min(...msaLines.map((l) => l.y));
    const dotForBullet = allDots[0];
    assert.ok(
      Math.abs(dotForBullet.y - (firstLineY - BODY_SIZE_FOR_TESTS * 0.32)) < 1,
      "dot must pair with the first wrapped line only",
    );
    for (const line of msaLines.filter((l) => l.y !== firstLineY)) {
      assert.ok(
        Math.abs(line.y - (dotForBullet.y + BODY_SIZE_FOR_TESTS * 0.32)) > 0.5,
        "continuation lines must not get their own dot",
      );
    }
  });

  it("layout with real jsPDF measurer keeps one dot for MSA bullet", () => {
    const structured = structureResumeText(WRAPPED_TELUS_SNIPPET);
    const doc = resumeDataToParsedDocument({
      profile: { name: "Vivek Narayanan", profession: "", yearsOfExperience: 0, location: "", email: "", phone: "" },
      experience: structured.experience.map((e, i) => ({ ...e, id: `e${i}` })),
      competencies: [],
      education: [],
      generatedSummary: "",
    });
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    const dotsNearMsa = layout.pages.flatMap((p) => p.dots).length;
    assert.ok(dotsNearMsa >= 1);
    const joined = layout.pages.flatMap((p) => p.texts).map((t) => t.text).join(" ");
    assert.ok(joined.includes("translating client strategy"));
  });
});

describe("parseResumeContent — wrapped entry bullets", () => {
  it("merges 3-line soft wrap under one entry into one bullet", () => {
    const content = [
      "Vivek Narayanan",
      "vivek@example.com",
      "PROFESSIONAL EXPERIENCE",
      "Client-facing Product Manager | TELUS Health Wellbeing    September '21 — Present",
      ...WRAPPED_MSA_LINES,
    ].join("\n");
    const doc = parseResumeContent(content);
    const entry = doc.sections.find((s) => s.heading === "PROFESSIONAL EXPERIENCE")!.blocks[0];
    assert.ok(entry.kind === "entry");
    assert.equal(entry.bullets.length, 1);
    assert.ok(entry.bullets[0].includes("translating client strategy"));
    assert.ok(entry.bullets[0].includes("prioritized SOWs"));
  });
});

describe("layoutResumeDocument — entry title and date same baseline", () => {
  it("long title + date share the same y coordinate", () => {
    const doc: ParsedResumeDocument = {
      name: null,
      contactLine: null,
      sections: [
        {
          heading: "PROFESSIONAL EXPERIENCE",
          blocks: [
            {
              kind: "entry",
              title: "Client-facing Product Manager | TELUS Health Wellbeing",
              dateRight: "September '21 — Present",
              bullets: [],
            },
          ],
        },
      ],
    };
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    const titleCmd = layout.pages[0].texts.find((t) => /Client-facing Product Manager/i.test(t.text))!;
    const dateCmd = layout.pages[0].texts.find((t) => /September '21/.test(t.text))!;
    assert.ok(titleCmd);
    assert.ok(dateCmd);
    assert.equal(titleCmd.y, dateCmd.y, "title and date must share one baseline");
    assert.equal(dateCmd.align, "right");
  });
});

/* --------------------------------- golden fixture (Vivek original) --------------------------------- */

function assertNoLetterSpacedDraws(layout: ReturnType<typeof layoutResumeDocument>) {
  for (const t of layout.pages.flatMap((p) => p.texts)) {
    assert.ok(!LETTER_SPACED_RE.test(t.text), `letter-spaced draw text: "${t.text.slice(0, 60)}..."`);
  }
}

describe("vivek-pm-resume fixture", () => {
  it("contact line includes Richmond Hill and excludes summary fragments", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    assert.ok(doc.contactLine?.includes("Richmond Hill"), `contactLine: ${doc.contactLine}`);
    assert.ok(!doc.contactLine?.includes("into prioritized"), `contactLine polluted: ${doc.contactLine}`);
    assert.ok(!doc.contactLine?.includes("shippable roadmaps"), `contactLine polluted: ${doc.contactLine}`);
    assert.ok(doc.contactLine?.includes("vivekn.xyz"), `missing website: ${doc.contactLine}`);
  });

  it("malicious line-2 summary fragment is not consumed as contactLine", () => {
    const malicious = PM_FIXTURE.replace(
      "Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar | vivekn.xyz",
      "into prioritized, shippable roadmaps.",
    );
    const withContactLater =
      malicious +
      "\nRichmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar | vivekn.xyz";
    const doc = parseResumeContent(withContactLater);
    assert.equal(doc.contactLine, null, "summary fragment must not become contactLine");
    const summarySection = doc.sections.find((s) => s.heading === "PROFESSIONAL SUMMARY");
    assert.ok(summarySection, "summary section must exist");
    const prose = summarySection!.blocks.map((b) => (b.kind === "paragraph" ? b.text : "")).join(" ");
    assert.ok(prose.includes("into prioritized") || prose.includes("shippable roadmaps"), "fragment should parse as body");
  });

  it("strips a summary fragment mixed into an otherwise-valid contact row (the founder Download & apply header)", () => {
    const mixed = PM_FIXTURE.replace(
      "Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar | vivekn.xyz",
      "into prioritized, shippable roadmaps. | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar | vivekn.xyz",
    );
    const doc = parseResumeContent(mixed);
    assert.ok(doc.contactLine?.includes("+1 (437)-224-8332"), `contactLine: ${doc.contactLine}`);
    assert.ok(doc.contactLine?.includes("viveknyan@gmail.com"));
    assert.ok(doc.contactLine?.includes("vivekn.xyz"));
    assert.ok(!doc.contactLine?.includes("into prioritized"), `contactLine polluted: ${doc.contactLine}`);
    assert.ok(!doc.contactLine?.includes("shippable roadmaps"), `contactLine polluted: ${doc.contactLine}`);
  });

  it("resumeDataToParsedDocument drops polluted location from contact line", () => {
    const data = blankResumeData({
      profile: {
        name: "Vivek Narayanan",
        profession: "PM",
        yearsOfExperience: 13,
        location: "into prioritized, shippable roadmaps.",
        email: "viveknyan@gmail.com",
        phone: "+1 (437)-224-8332",
        linkedin: "linkedin.com/in/viveknar",
        website: "vivekn.xyz",
      },
    });
    const doc = resumeDataToParsedDocument(data);
    assert.ok(doc.contactLine?.includes("viveknyan@gmail.com"));
    assert.ok(doc.contactLine?.includes("vivekn.xyz"));
    assert.ok(!doc.contactLine?.includes("into prioritized"));
    assert.ok(!doc.contactLine?.includes("shippable roadmaps"));
  });

  it("parses three competency categories (not a single Skills dump)", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    const compSection = doc.sections.find((s) => s.heading === "CORE COMPETENCIES");
    assert.ok(compSection);
    const categories = compSection!.blocks.filter((b) => b.kind === "competency");
    assert.equal(categories.length, 3);
    const names = categories.map((c) => (c.kind === "competency" ? c.category : ""));
    assert.ok(names.includes("Product"));
    assert.ok(names.some((n) => /delivery/i.test(n)));
    assert.ok(names.includes("Technical"));
  });

  it("parses INDEPENDENT PROJECTS and EDUCATION sections", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    assert.ok(doc.sections.some((s) => s.heading === "INDEPENDENT PROJECTS"));
    assert.ok(doc.sections.some((s) => s.heading === "EDUCATION & PROFESSIONAL DEVELOPMENT"));
    const projects = doc.sections.find((s) => s.heading === "INDEPENDENT PROJECTS");
    assert.ok(projects!.blocks.some((b) => b.kind === "entry" && /intervu/i.test(b.title)));
    assert.ok(projects!.blocks.some((b) => b.kind === "entry" && /0/.test(b.title)));
  });

  it("layout has no letter-spaced draw strings (fake measurer)", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assertNoLetterSpacedDraws(layout);
    const productBlock = doc.sections
      .find((s) => s.heading === "CORE COMPETENCIES")!
      .blocks.find((b) => b.kind === "competency" && b.category === "Product");
    assert.ok(productBlock && productBlock.kind === "competency");
    const productLine = layout.pages.flatMap((p) => p.texts).find((t) => t.text.includes("Lifecycle") || t.text.includes("API Lifecycle"));
    assert.ok(productLine, "Product competency must contain Lifecycle as contiguous substring");
    assert.ok(!/\b0\s+->\s+1\b/.test(layout.pages.flatMap((p) => p.texts).map((t) => t.text).join(" ")), "0->1 must not be split with padded inner spaces");
  });

  it("layout has no letter-spaced draw strings (real jsPDF measurer)", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    assertNoLetterSpacedDraws(layout);
    const productRemainder = layout.pages.flatMap((p) => p.texts).find((t) => !t.bold && /Lifecycle/i.test(t.text));
    assert.ok(productRemainder, "Product remainder must contain Lifecycle contiguously");
  });

  it("TELUS entry has 8 full bullets including long MSA and Challenge Streaks lines", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    const expSection = doc.sections.find((s) => s.heading === "PROFESSIONAL EXPERIENCE");
    assert.ok(expSection);
    const telus = expSection!.blocks.find(
      (b) => b.kind === "entry" && /TELUS Health Wellbeing/i.test(b.title),
    );
    assert.ok(telus && telus.kind === "entry");
    assert.equal(telus.bullets.length, 8, `expected 8 TELUS bullets, got ${telus.bullets.length}`);
    const msa = telus.bullets.find((b) => /MSA/i.test(b));
    assert.ok(msa?.includes("translating client strategy"), "MSA bullet must be the long merged line");
    assert.ok(!msa?.endsWith("MSA."), "MSA bullet must not be truncated one-liner");
    const streaks = telus.bullets.find((b) => /Challenge Streaks/i.test(b));
    assert.ok(streaks?.includes("owned requirements, effort estimation"), "Challenge Streaks bullet must be full text");
  });

  it("PM fixture may span 1–2 US-Letter pages with real jsPDF measurer", () => {
    const doc = parseResumeContent(PM_FIXTURE);
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    assert.ok(layout.pages.length >= 1 && layout.pages.length <= 2, `expected 1-2 pages, got ${layout.pages.length}`);
  });
});

function lastDrawBaseline(layout: ReturnType<typeof layoutResumeDocument>): number {
  const ys = layout.pages.flatMap((p) => [...p.texts.map((t) => t.y), ...p.dots.map((d) => d.y)]);
  return ys.length > 0 ? Math.max(...ys) : 0;
}

describe("vivek-csm-golden-resume zip fixture", () => {
  it("fits exactly one US-Letter page with real jsPDF measurer", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    const maxDrawY = DEFAULT_PAGE_METRICS.pageHeight - DEFAULT_PAGE_METRICS.marginBottom - DESCENT_PAD;
    const lastBaseline = lastDrawBaseline(layout);
    assert.equal(layout.pages.length, 1, `expected 1 page, got ${layout.pages.length}; last baseline=${lastBaseline}, max=${maxDrawY}`);
    assert.ok(lastBaseline <= maxDrawY, `last baseline ${lastBaseline} exceeds page limit ${maxDrawY}`);
  });

  it("contact line includes Richmond Hill location", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    assert.ok(doc.contactLine?.includes("Richmond Hill"), `contactLine: ${doc.contactLine}`);
  });

  it("parses three competency categories — never a Skills wrapper block", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const compSection = doc.sections.find((s) => s.heading === "CORE COMPETENCIES");
    assert.ok(compSection);
    const categories = compSection!.blocks.filter((b) => b.kind === "competency");
    assert.equal(categories.length, 3);
    const names = categories.map((c) => (c.kind === "competency" ? c.category : ""));
    assert.ok(names.some((n) => /customer success/i.test(n)));
    assert.ok(names.some((n) => /delivery/i.test(n)));
    assert.ok(names.some((n) => /platform/i.test(n)));
    assert.ok(!names.includes("Skills"));
  });

  it("layout draw texts do not start competency lines with Skills:", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    const allText = layout.pages.flatMap((p) => p.texts).map((t) => t.text).join("\n");
    assert.ok(!/^Skills:/m.test(allText) && !/\nSkills:/.test(allText));
    assert.ok(allText.includes("Customer Success"));
    assert.ok(allText.includes("University at Buffalo") || allText.includes("Buffalo"));
  });

  it("keeps empty INDEPENDENT PROJECTS section when header is present", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const projects = doc.sections.find((s) => s.heading === "INDEPENDENT PROJECTS");
    assert.ok(projects, "INDEPENDENT PROJECTS section must exist");
    assert.equal(projects!.blocks.length, 0);
  });

  it("education section uses golden heading and intact University at Buffalo", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const edu = doc.sections.find((s) => s.heading === "EDUCATION & PROFESSIONAL DEVELOPMENT");
    assert.ok(edu);
    const bullets = edu!.blocks.filter((b) => b.kind === "bullets").flatMap((b) => (b.kind === "bullets" ? b.items : []));
    assert.ok(bullets.some((b) => /University at Buffalo/i.test(b)));
    assert.ok(bullets.some((b) => /University of Illinois at Urbana-Champaign/i.test(b)));
    assert.ok(!bullets.some((b) => /University \| Buffalo/i.test(b)));
    assert.ok(bullets.some((b) => /MITx/i.test(b)));
  });

  it("layout text has no Hands-on with robotic tailor spam", () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const pdf = new jsPDF({ unit: "pt", format: [DEFAULT_PAGE_METRICS.pageWidth, DEFAULT_PAGE_METRICS.pageHeight] });
    const layout = layoutResumeDocument(doc, jsPdfMeasurer(pdf));
    const joined = layout.pages.flatMap((p) => p.texts).map((t) => t.text).join(" ");
    assert.ok(!/Hands-on with/i.test(joined));
  });

  it("resumeDataToParsedDocument unpacks Skills category blob", () => {
    const data = blankResumeData({
      competencies: [{ category: "Skills", skills: ["Product: Roadmap", "Delivery: Agile"] }],
    });
    const doc = resumeDataToParsedDocument(data);
    const comp = doc.sections.find((s) => s.heading === "CORE COMPETENCIES");
    assert.ok(comp);
    const names = comp!.blocks.filter((b) => b.kind === "competency").map((b) => (b.kind === "competency" ? b.category : ""));
    assert.ok(names.includes("Product"));
    assert.ok(names.includes("Delivery"));
    assert.ok(!names.includes("Skills"));
  });

  it("writes sample PDF and extracted text contains golden markers", async () => {
    const doc = parseResumeContent(CSM_GOLDEN_FIXTURE);
    const bytes = renderResumePdf(doc);
    const outPath = path.join("/tmp", "test-resume-csm-golden-jspdf.pdf");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outPath, Buffer.from(bytes));

    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(bytes));
    const text = result.text.join("\n");
    assert.ok(text.includes("Richmond Hill"));
    assert.ok(/Customer Success/i.test(text));
    assert.ok(/Delivery/i.test(text));
    assert.ok(/Platform/i.test(text));
    assert.ok(/MITx/i.test(text));
    assert.ok(/University at Buffalo/i.test(text) || /Buffalo/i.test(text));
    assert.ok(!/Hands-on with/i.test(text));
    assert.ok(!/^Skills:/m.test(text));
  });
});
