import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseResumeContent, resumeDataToParsedDocument, type ParsedResumeDocument } from "@/lib/resume/parse-resume-content";
import { readFileSync } from "node:fs";
import { extractText } from "unpdf";
import {
  layoutResumeDocument,
  fitResumeLayout,
  defaultResumeStyle,
  styleFromLayoutProfile,
  floorBodySizeFor,
  renderResumePdf,
  resumeNeedsUnicodeFont,
  deriveResumePdfFilename,
  type TextMeasurer,
} from "@/lib/resume/render-pdf";
import type { ResumeLayoutProfile } from "@/lib/resume/layout-profile";
import type { ResumeData } from "@/types/resume";

const STYLE = defaultResumeStyle();
const BODY = STYLE.bodySize;
const RIGHT_EDGE = STYLE.pageWidth - STYLE.marginRight;

/** Deterministic fake measurer — monospace approximation, no jsPDF/canvas
 *  dependency, so layout tests run fast and don't depend on font metrics. */
const fakeMeasurer: TextMeasurer = {
  widthOf: (text, size) => text.length * size * 0.5,
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

const LONG_SENTENCE = "Coordinated a cross-functional launch across four regions with engineering, support and sales, cutting time to value for new accounts by a third";

function textsOf(layout: ReturnType<typeof layoutResumeDocument>) {
  return layout.pages.flatMap((p) => p.texts);
}

/** Draw commands grouped into printed lines by baseline. */
function linesOf(texts: ReturnType<typeof textsOf>) {
  const byY = new Map<number, typeof texts>();
  for (const t of texts) byY.set(t.y, [...(byY.get(t.y) ?? []), t]);
  return [...byY.values()].map((line) => line.sort((a, b) => a.x - b.x));
}

describe("layoutResumeDocument — header and headings", () => {
  it("centres the name and contact line between the margins", () => {
    const texts = textsOf(layoutResumeDocument(SAMPLE_DOC, fakeMeasurer));
    const centre = (STYLE.marginLeft + RIGHT_EDGE) / 2;
    for (const text of ["Vivek Narayanan", "Richmond Hill | viveknyan@gmail.com"]) {
      const cmd = texts.find((t) => t.text === text);
      assert.ok(cmd, text);
      assert.equal(cmd!.align, "center");
      assert.equal(cmd!.x, centre);
    }
  });

  it("left-aligns the name when the original did", () => {
    const texts = textsOf(layoutResumeDocument(SAMPLE_DOC, fakeMeasurer, { ...STYLE, centeredHeader: false }));
    const name = texts.find((t) => t.text === "Vivek Narayanan")!;
    assert.equal(name.align, "left");
    assert.equal(name.x, STYLE.marginLeft);
  });

  it("draws each section heading bold at the left margin with one full-width rule below its baseline", () => {
    const layout = layoutResumeDocument(SAMPLE_DOC, fakeMeasurer);
    const heading = textsOf(layout).find((t) => t.text === "PROFESSIONAL SUMMARY")!;
    assert.equal(heading.bold, true);
    assert.equal(heading.x, STYLE.marginLeft);
    assert.equal(layout.pages[0].rules.length, 2);
    const rule = layout.pages[0].rules[0];
    assert.equal(rule.x1, STYLE.marginLeft);
    assert.equal(rule.x2, RIGHT_EDGE);
    assert.ok(rule.y - heading.y >= STYLE.headingSize * 0.2, "the rule sits under the heading's descenders, never through its letters");
  });

  it("keeps the sections in the order given", () => {
    const order = textsOf(layoutResumeDocument(SAMPLE_DOC, fakeMeasurer))
      .map((t) => t.text.trim())
      .filter((t) => ["PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "Product Manager | Acme"].includes(t));
    assert.deepEqual(order, ["PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "Product Manager | Acme"]);
  });

  it("puts an entry's dates at the right margin on the title's baseline, and draws none when it has no dates", () => {
    const texts = textsOf(layoutResumeDocument(SAMPLE_DOC, fakeMeasurer));
    const date = texts.find((t) => t.text === "September '21 — Present")!;
    const title = texts.find((t) => t.text.startsWith("Product Manager"))!;
    assert.equal(date.align, "right");
    assert.equal(date.x, RIGHT_EDGE);
    assert.equal(date.y, title.y);
    const undated: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "X", blocks: [{ kind: "entry", title: "Volunteer", dateRight: null, bullets: [] }] }] };
    assert.equal(textsOf(layoutResumeDocument(undated, fakeMeasurer)).filter((t) => t.align === "right").length, 0);
  });

  it("wraps a long title short of its dates instead of running under them", () => {
    const title = "Senior Director of Customer Experience and Strategic Operations | Very Long Company Name International Holdings";
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "X", blocks: [{ kind: "entry", title, dateRight: "January 2019 — Present", bullets: [] }] }] };
    const texts = textsOf(layoutResumeDocument(doc, fakeMeasurer));
    const date = texts.find((t) => t.align === "right")!;
    const dateLeft = date.x - fakeMeasurer.widthOf(date.text, date.size, false);
    const firstLine = texts.filter((t) => t.y === date.y && t.align === "left");
    for (const t of firstLine) assert.ok(t.x + fakeMeasurer.widthOf(t.text.trimEnd(), t.size, true) < dateLeft, `"${t.text}" overlaps the dates`);
    assert.ok(texts.filter((t) => t.bold).length >= 2, "the title takes a second line");
  });
});

describe("layoutResumeDocument — bullets and pagination", () => {
  it("draws a bullet as a filled circle, never as bullet text", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items: ["One thing."] }] }] };
    const layout = layoutResumeDocument(doc, fakeMeasurer);
    assert.ok(!textsOf(layout).some((t) => /^[●•]/.test(t.text)));
    assert.equal(layout.pages[0].dots.length, 1);
    assert.ok(layout.pages[0].dots[0].x < STYLE.marginLeft + STYLE.bulletIndent);
  });

  it("spills long content onto more pages without splitting a bullet: each dot shares its page with its first line", () => {
    const items = Array.from({ length: 80 }, (_, i) => `${i} ${LONG_SENTENCE}`);
    const layout = layoutResumeDocument({ name: null, contactLine: null, sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "bullets", items }] }] }, fakeMeasurer);
    assert.ok(layout.pages.length > 1);
    let dots = 0;
    for (const page of layout.pages) {
      for (const dot of page.dots) {
        dots++;
        assert.ok(page.texts.some((t) => Math.abs(t.y - (dot.y + BODY * 0.3)) < 0.01), `dot at ${dot.y} has its text on the same page`);
      }
      for (const t of page.texts) assert.ok(t.y <= STYLE.pageHeight - STYLE.marginBottom, `"${t.text}" runs into the bottom margin`);
    }
    assert.equal(dots, 80);
  });

  it("never strands an entry's title at the foot of a page: its first bullet comes with it", () => {
    const blocks = Array.from({ length: 14 }, (_, i) => ({ kind: "entry" as const, title: `Role ${i} | Company`, dateRight: `20${10 + i} — 20${11 + i}`, bullets: [LONG_SENTENCE, LONG_SENTENCE] }));
    const layout = layoutResumeDocument({ name: null, contactLine: null, sections: [{ heading: "EXPERIENCE", blocks }] }, fakeMeasurer);
    assert.ok(layout.pages.length > 1);
    for (const page of layout.pages) {
      const titles = page.texts.filter((t) => t.bold && t.text.startsWith("Role"));
      for (const title of titles) {
        assert.ok(page.texts.some((t) => t.y > title.y && !t.bold), `"${title.text}" has a bullet under it on its page`);
      }
    }
  });
});

describe("layoutResumeDocument — words keep their spaces (copyable, parseable text)", () => {
  const paragraph: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [{ kind: "paragraph", text: `${LONG_SENTENCE}. ${LONG_SENTENCE}. ${LONG_SENTENCE}.` }] }] };

  it("stretches a justified line to the right edge with every word but the last carrying its space", () => {
    const lines = linesOf(textsOf(layoutResumeDocument(paragraph, fakeMeasurer)).filter((t) => t.text !== "SUMMARY"));
    assert.ok(lines.length >= 3);
    for (const line of lines.slice(0, -1)) {
      assert.ok(line.length > 1);
      line.slice(0, -1).forEach((t) => assert.ok(t.text.endsWith(" "), `"${t.text}" keeps its trailing space`));
      const last = line[line.length - 1];
      assert.ok(Math.abs(last.x + fakeMeasurer.widthOf(last.text, BODY, false) - RIGHT_EDGE) < 0.01, "justified line reaches the right edge");
    }
    const lastLine = lines[lines.length - 1];
    assert.equal(lastLine.length, 1, "the last line is one ragged string");
    assert.ok(lastLine[0].text.includes(" "));
  });

  it("draws every line as one string with real spaces when the original was ragged", () => {
    const lines = linesOf(textsOf(layoutResumeDocument(paragraph, fakeMeasurer, { ...STYLE, justify: false })).filter((t) => t.text !== "SUMMARY"));
    for (const line of lines) assert.equal(line.length, 1);
  });

  it("sets a skills line's label in bold, followed by a space, then the skills", () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SKILLS", blocks: [{ kind: "competency", category: "Technical", items: "SQL, Python, Go" }] }] };
    const texts = textsOf(layoutResumeDocument(doc, fakeMeasurer));
    const label = texts.find((t) => t.bold && t.text.startsWith("Technical:"))!;
    assert.equal(label.text, "Technical: ");
    const rest = texts.find((t) => !t.bold && t.y === label.y)!;
    assert.equal(rest.text, "SQL, Python, Go");
    assert.ok(rest.x >= label.x + fakeMeasurer.widthOf("Technical:", BODY, true) + fakeMeasurer.widthOf(" ", BODY, false) - 0.01);
  });
});

describe("fitResumeLayout — the original's page count", () => {
  const long: ParsedResumeDocument = {
    name: "Jane Doe",
    contactLine: "Toronto | jane@example.com",
    sections: [
      { heading: "SUMMARY", blocks: [{ kind: "paragraph", text: `${LONG_SENTENCE}. ${LONG_SENTENCE}.` }] },
      { heading: "EXPERIENCE", blocks: Array.from({ length: 9 }, (_, i) => ({ kind: "entry" as const, title: `Role ${i} | Company`, dateRight: "2019 — 2021", bullets: [LONG_SENTENCE, LONG_SENTENCE, LONG_SENTENCE] })) },
    ],
  };

  it("tightens spacing, then leading, then type until the content fits the target, never below the floor", () => {
    const loose = layoutResumeDocument(long, fakeMeasurer, STYLE);
    assert.equal(loose.pages.length, 2, "fixture overflows one page as designed");
    const fit = fitResumeLayout(long, fakeMeasurer, STYLE, { targetPages: 1, floorBodySize: floorBodySizeFor(STYLE, false) });
    assert.equal(fit.layout.pages.length, 1);
    assert.equal(fit.fits, true);
    assert.ok(fit.style.bodySize >= 8 - 1e-9 && fit.style.bodySize < BODY, "it had to shrink the type, within the floor");
    assert.ok(fit.style.blockGap < STYLE.blockGap && fit.style.lineHeight < STYLE.lineHeight, "spacing and leading went first");
    assert.equal(fit.style.marginLeft, STYLE.marginLeft, "margins are the original's and never move");
  });

  it("leaves a layout that already fits exactly as designed", () => {
    const fit = fitResumeLayout(SAMPLE_DOC, fakeMeasurer, STYLE, { targetPages: 1, floorBodySize: 8 });
    assert.deepEqual(fit.style, STYLE);
  });

  it("takes the next page at full size, and says so, when even the floor can't fit the target", () => {
    const huge: ParsedResumeDocument = { ...long, sections: [...long.sections, ...long.sections, ...long.sections] };
    const fit = fitResumeLayout(huge, fakeMeasurer, STYLE, { targetPages: 1, floorBodySize: 8 });
    assert.equal(fit.fits, false);
    assert.ok(fit.layout.pages.length >= 2);
    const atFloor = fitResumeLayout(huge, fakeMeasurer, STYLE, { targetPages: fit.layout.pages.length, floorBodySize: 8 });
    assert.equal(atFloor.fits, true);
  });

  it("without an original, aims for the fewest pages the floor allows", () => {
    const fit = fitResumeLayout(long, fakeMeasurer, STYLE, { targetPages: null, floorBodySize: 8 });
    assert.equal(fit.layout.pages.length, 1);
    assert.equal(fit.targetPages, 1);
  });
});

const PROFILE: ResumeLayoutProfile = {
  version: 1,
  pageWidth: 595.28,
  pageHeight: 841.89,
  pageCount: 1,
  marginLeft: 23,
  marginRight: 23,
  marginTop: 26,
  marginBottom: 26,
  bodySize: 7.75,
  lineHeight: 1.32,
  nameSize: 14,
  contactSize: 7.4,
  headingSize: 8.1,
  titleSize: 8.2,
  dateSize: 7.4,
  bulletIndent: 11.3,
  family: "serif",
  justified: true,
  centeredHeader: true,
};

describe("styleFromLayoutProfile", () => {
  it("prints on the original's paper, margins and type sizes", () => {
    const style = styleFromLayoutProfile(PROFILE);
    const texts = textsOf(layoutResumeDocument(SAMPLE_DOC, fakeMeasurer, style));
    assert.equal(style.pageWidth, 595.28);
    assert.equal(style.family, "serif");
    const heading = texts.find((t) => t.text === "PROFESSIONAL SUMMARY")!;
    assert.equal(heading.x, 23);
    assert.equal(heading.size, 8.1);
    const name = texts.find((t) => t.text === "Vivek Narayanan")!;
    assert.ok(Math.abs(name.y - 14 * 0.72 - 26) < 0.01, "the name's cap height sits on the top margin");
  });
});

/* --------------------------------- renderResumePdf (real bytes) --------------------------------- */

const FONTS = {
  regular: readFileSync("public/fonts/liberation/LiberationSans-Regular.ttf").toString("base64"),
  bold: readFileSync("public/fonts/liberation/LiberationSans-Bold.ttf").toString("base64"),
};

const ARROWS: ParsedResumeDocument = {
  name: "Łucja Wiśniewska",
  contactLine: "Toronto | lucja@example.com",
  sections: [{ heading: "EXPERIENCE", blocks: [{ kind: "entry", title: "Growth Lead | Café Nguyễn", dateRight: "2022 — Present", bullets: ["Built the funnel: discovery → scrape → enrich → score, with results ≥ 95% confidence across every regional market we served in the year."] }] }],
};

async function pdfText(bytes: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

describe("renderResumePdf", () => {
  it("needs an embedded font only for characters the built-in fonts lack", () => {
    assert.equal(resumeNeedsUnicodeFont(SAMPLE_DOC), false, "— and ' are WinAnsi");
    assert.equal(resumeNeedsUnicodeFont(ARROWS), true);
  });

  it("prints arrows and Polish and Vietnamese letters with the embedded font, never as mojibake", async () => {
    const result = renderResumePdf(ARROWS, { fonts: FONTS });
    const text = await pdfText(result.bytes);
    assert.match(text, /Łucja Wiśniewska/);
    assert.match(text, /Café Nguyễn/);
    assert.match(text, /discovery → scrape → enrich → score/);
    assert.doesNotMatch(text, /!'/);
  });

  it("spells the symbols out when the font files couldn't load", async () => {
    const text = await pdfText(renderResumePdf(ARROWS).bytes);
    assert.match(text, /discovery -> scrape -> enrich -> score/);
    assert.match(text, />= 95%/);
    assert.match(text, /Lucja Wisniewska/);
    assert.doesNotMatch(text, /!'/);
  });

  it("keeps the spaces between words on justified lines when the text is read back", async () => {
    const doc: ParsedResumeDocument = { name: null, contactLine: null, sections: [{ heading: "SUMMARY", blocks: [{ kind: "paragraph", text: `${LONG_SENTENCE}. ${LONG_SENTENCE}. ${LONG_SENTENCE}.` }] }] };
    const text = await pdfText(renderResumePdf(doc).bytes);
    assert.match(text, /Coordinated a cross-functional launch across four regions with engineering, support and sales/);
    assert.doesNotMatch(text, /launchacross|withengineering/);
  });

  it("prints in the original's typeface family and paper, and reports the page count against the original's", async () => {
    const result = renderResumePdf(SAMPLE_DOC, { profile: PROFILE });
    const raw = Buffer.from(result.bytes).toString("latin1");
    assert.match(raw, /Times-Roman/);
    assert.match(raw, /\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    assert.equal(result.pages, 1);
    assert.equal(result.originalPages, 1);
    assert.equal(result.fits, true);
    assert.equal(result.bodySize, 7.75);
  });
});

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

