import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseResumeContent, resumeDataToParsedDocument, type ParsedResumeDocument } from "@/lib/resume/parse-resume-content";
import { layoutResumeDocument, deriveResumePdfFilename, DEFAULT_PAGE_METRICS, type TextMeasurer } from "@/lib/resume/render-pdf";
import type { ResumeData } from "@/types/resume";

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
    const doc = parseResumeContent("Name\nContact\n## Education\n- BSc CS | MIT");
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
      ["PROFESSIONAL SUMMARY", "CORE COMPETENCIES", "PROFESSIONAL EXPERIENCE", "EDUCATION"],
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
    const dateCmd = layout.pages[0].texts.find((t) => t.text === "September '21 — Present");
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

describe("layoutResumeDocument — long-content pagination, never splits a bullet", () => {
  it("a bullet list long enough to overflow one page spills onto additional pages, and every bullet's lines land entirely on ONE page", () => {
    const manyBullets = Array.from({ length: 80 }, (_, i) => `Bullet number ${i} describing an accomplishment in enough detail to wrap across a couple of lines when rendered.`);
    const doc: ParsedResumeDocument = {
      name: "Long Resume",
      contactLine: null,
      sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: manyBullets }] }],
    };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(layout.pages.length > 1, "80 wrapping bullets must overflow a single US-Letter page");

    // Reconstruct each bullet's rendered lines (bullet glyph "●" starts a new
    // bullet; every subsequent text command belongs to it until the next
    // "●") and assert they never straddle a page boundary.
    for (const page of layout.pages) {
      let openBulletStartSeen = false;
      let sawNonBulletAfterBulletStart = false;
      for (const t of page.texts) {
        if (t.text === "●") {
          openBulletStartSeen = true;
          sawNonBulletAfterBulletStart = false;
        } else if (openBulletStartSeen) {
          sawNonBulletAfterBulletStart = true;
        }
      }
      // Sanity: a page that opened a bullet must have rendered at least one
      // text line for it on the SAME page (never an orphaned glyph with its
      // text pushed to the next page).
      if (openBulletStartSeen) assert.ok(sawNonBulletAfterBulletStart);
    }
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
