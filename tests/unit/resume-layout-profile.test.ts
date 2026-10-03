import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDocumentProxy, extractText } from "unpdf";
import { measureResumeLayout, parseResumeLayoutProfile, type LayoutPage, type ResumeLayoutProfile } from "@/lib/resume/layout-profile";
import { rememberResumeLayout, recallResumeLayout, RESUME_LAYOUTS_KEY } from "@/lib/resume/layout-profile-storage";
import { extractPDFTextInBrowser } from "@/lib/local-ai/extract-in-browser";
import { resumeDataFromPlainText } from "@/lib/resume/structure-resume-text";
import { parseResumeLocally } from "@/lib/local-ai/parse-resume";
import { resumeDataToParsedDocument } from "@/lib/resume/parse-resume-content";
import { renderResumePdf } from "@/lib/resume/render-pdf";
import { resumePdfNote } from "@/lib/resume/export-zip-pdf";
import type { ResumeData } from "@/types/resume";

/**
 * The export prints a tailored résumé in the layout of the person's own PDF
 * (Vivek, 2026-10-02: the tailored PDF "is not dense...no tight borders...its
 * not 1 page"). These measure originals the way the upload does and check
 * the export reproduces them.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/resume-layouts/${name}.pdf`));
const FONTS = {
  sans: { regular: readFileSync("public/fonts/liberation/LiberationSans-Regular.ttf").toString("base64"), bold: readFileSync("public/fonts/liberation/LiberationSans-Bold.ttf").toString("base64") },
  serif: { regular: readFileSync("public/fonts/liberation/LiberationSerif-Regular.ttf").toString("base64"), bold: readFileSync("public/fonts/liberation/LiberationSerif-Bold.ttf").toString("base64") },
};

async function pagesOf(bytes: Uint8Array): Promise<LayoutPage[]> {
  const pdf = await getDocumentProxy(bytes.slice());
  const pages: LayoutPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();
    pages.push({ width: x1 - x0, height: y1 - y0, origin: [x0, y0], items: content.items as LayoutPage["items"], styles: content.styles });
  }
  return pages;
}

async function measure(bytes: Uint8Array): Promise<ResumeLayoutProfile> {
  const profile = measureResumeLayout(await pagesOf(bytes));
  assert.ok(profile, "measurable");
  return profile!;
}

/** Upload → structure → export, the way the app runs it. */
async function exportOf(bytes: Uint8Array, grow = "") {
  const profile = await measure(bytes);
  const { text } = await extractPDFTextInBrowser(bytes.slice().buffer);
  const data = resumeDataFromPlainText(text!);
  for (const e of data.experience) e.description = e.description.split("\n").map((l) => (l.trim() ? l + grow : l)).join("\n");
  const result = renderResumePdf(resumeDataToParsedDocument(data), { profile, fonts: FONTS[profile.family] });
  return { profile, data, result, back: await measure(new Uint8Array(result.bytes)) };
}

function near(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

describe("measureResumeLayout", () => {
  it("reads a two-page serif Letter original: paper, margins, sizes, family, alignment, page count", async () => {
    const p = await measure(fixture("nurse-serif-letter-2p"));
    assert.equal(p.pageCount, 2);
    assert.equal(p.pageWidth, 612);
    assert.equal(p.family, "serif");
    assert.equal(p.justified, false);
    assert.equal(p.centeredHeader, true);
    near(p.marginLeft, 72, 1, "1in left margin");
    near(p.bodySize, 11.5, 0.1, "body size");
    assert.ok(p.nameSize > p.headingSize && p.headingSize > p.bodySize);
  });

  it("reads an A4 original with a left-aligned header", async () => {
    const p = await measure(fixture("accountant-a4-ragged"));
    near(p.pageWidth, 595, 1, "A4 width");
    near(p.pageHeight, 842, 1, "A4 height");
    assert.equal(p.centeredHeader, false);
    near(p.marginLeft, 43.2, 1, "0.6in margin");
    near(p.bodySize, 10, 0.1, "body");
  });

  it("reads a dense one-page original", async () => {
    const p = await measure(fixture("marketing-dense-unicode"));
    assert.equal(p.pageCount, 1);
    near(p.marginLeft, 23, 1, "0.32in margin");
    near(p.bodySize, 8, 0.1, "8pt body");
    assert.equal(p.family, "sans");
  });

  it("returns null for a page with too little text to say", () => {
    assert.equal(measureResumeLayout([{ width: 612, height: 792, items: [{ str: "Hello", transform: [10, 0, 0, 10, 72, 700], width: 30, height: 10 }] }]), null);
  });

  it("refuses a malformed stored profile", () => {
    assert.equal(parseResumeLayoutProfile({ version: 2 }), null);
    assert.equal(parseResumeLayoutProfile({ version: 1, pageWidth: "612" }), null);
  });
});

describe("the export reproduces the original", () => {
  for (const name of ["nurse-serif-letter-2p", "accountant-a4-ragged", "marketing-dense-unicode"]) {
    it(`${name}: same paper, margins, body size, family and page count`, async () => {
      const { profile, result, back } = await exportOf(fixture(name));
      assert.equal(result.pages, profile.pageCount);
      assert.equal(result.fits, true);
      near(back.pageWidth, profile.pageWidth, 0.5, "paper width");
      near(back.pageHeight, profile.pageHeight, 0.5, "paper height");
      near(back.marginLeft, profile.marginLeft, 0.75, "left margin");
      near(back.marginTop, profile.marginTop, 1, "top margin");
      near(back.bodySize, profile.bodySize, 0.05, "body size");
      assert.equal(back.family, profile.family);
      assert.equal(back.centeredHeader, profile.centeredHeader);
    });
  }

  it("keeps the original's name line, contact line and sections it doesn't model", async () => {
    const { result } = await exportOf(fixture("nurse-serif-letter-2p"));
    const { text } = await extractText(new Uint8Array(result.bytes), { mergePages: true });
    assert.match(text, /Amara Okafor, RN/);
    assert.match(text, /Hamilton, ON \| amara\.okafor@example\.com \| \(905\) 555-0142/);
    assert.match(text, /Certifications/);
    assert.match(text, /ACLS, BLS, PALS — Heart and Stroke Foundation/);
  });

  it("the importer's parse keeps the header, headings, order and extra sections the export prints", async () => {
    const { text } = await extractPDFTextInBrowser(fixture("nurse-serif-letter-2p").slice().buffer);
    const { data } = await parseResumeLocally(text!, { skipDownload: true });
    assert.equal(data.parsed.sourceHeader?.nameLine, "Amara Okafor, RN");
    assert.deepEqual(data.parsed.additionalSections?.map((s) => s.heading), ["Certifications"]);
    assert.ok(data.parsed.sectionOrder?.length, "section order");
    assert.ok(data.parsed.sectionHeadings && Object.keys(data.parsed.sectionHeadings).length, "section headings");
  });

  it("the importer's parse keeps the Projects section and the person's own website, not their email's domain", async () => {
    const civil = await extractPDFTextInBrowser(fixture("civil-engineer-long-3p").slice().buffer);
    const { data } = await parseResumeLocally(civil.text!, { skipDownload: true });
    assert.deepEqual(data.parsed.projects?.map((p) => [p.role, p.dates]), [
      ["Bow River Pathway Bridge (volunteer design review)", "2022"],
      ["Open-source culvert sizing calculator", "2019"],
    ]);
    assert.ok(data.parsed.experience.some((e) => e.role === "Survey Technician" && e.dates === "2009"), "a role dated with one year");
    assert.equal(data.parsed.profile.website, undefined, "no site on this résumé; its email domain is not one");

    const marketing = await extractPDFTextInBrowser(fixture("marketing-dense-unicode").slice().buffer);
    const own = await parseResumeLocally(marketing.text!, { skipDownload: true });
    assert.equal(own.data.parsed.profile.website, "lucja.design");
  });

  it("fits a longer tailored text onto the original's one page by tightening, with the type held near the original's", async () => {
    const { profile, result } = await exportOf(fixture("marketing-dense-unicode"), " — rewritten for the role with the posting's own terms and a measurable outcome for each one, tested against what the hiring team asked for in the description");
    assert.equal(result.pages, 1);
    assert.ok(result.bodySize >= Math.min(profile.bodySize, Math.max(7, profile.bodySize * 0.9)) - 0.01, `body ${result.bodySize}`);
  });
});

describe("a tailored résumé is one page in the original's look", () => {
  async function onePageOf(name: string, roleTerms: string[] = []) {
    const bytes = fixture(name);
    const profile = await measure(bytes);
    const { text } = await extractPDFTextInBrowser(bytes.slice().buffer);
    const data = resumeDataFromPlainText(text!);
    const result = renderResumePdf(resumeDataToParsedDocument(data), { profile, fonts: FONTS[profile.family], onePage: true, roleTerms });
    const back = await measure(new Uint8Array(result.bytes));
    const printed = (await extractText(new Uint8Array(result.bytes).slice(), { mergePages: true })).text.replace(/\s+/g, " ");
    return { profile, data, result, printed, back };
  }

  it("prints a two-page original on one page by tightening alone: same paper, typeface and type size, nothing left out", async () => {
    const { profile, result, back } = await onePageOf("nurse-serif-letter-2p");
    assert.equal(profile.pageCount, 2);
    assert.equal(result.pages, 1);
    assert.deepEqual(result.leftOut, []);
    assert.equal(resumePdfNote(result), null);
    assert.equal(back.family, "serif");
    near(back.pageWidth, profile.pageWidth, 0.5, "paper");
    near(back.bodySize, profile.bodySize, 0.05, "type");
  });

  it("fits a three-page CV on one page with type held near the original's, leaving out only older roles' later bullets, and says which", async () => {
    const { profile, result, printed, back } = await onePageOf("civil-engineer-long-3p");
    assert.equal(profile.pageCount, 3);
    assert.equal(result.pages, 1);
    assert.equal(result.fits, true);
    assert.ok(result.bodySize >= profile.bodySize * 0.85 - 0.01, `body ${result.bodySize}`);
    assert.ok(back.marginLeft >= 25.2 - 0.5, `left ${back.marginLeft}`);
    assert.equal(back.family, "serif");
    // Eight roles and two side projects on three pages: about a quarter of the bullets can't stay.
    assert.ok(result.leftOut.length > 0 && result.leftOut.length <= 12, `${result.leftOut.length} left out`);
    for (const b of result.leftOut) {
      assert.match(b.entry, /Co-op|Field Engineer|Survey Technician|Junior Engineer|culvert/, `${b.entry}: an older role or side project`);
      assert.ok(!printed.includes(b.text.slice(0, 40)), "left out of the PDF");
    }
    assert.match(printed, /Lead design of a \$48M interchange rebuild/);
    assert.match(printed, /Professional Engineer \(P\.Eng\.\), APEGA, 2014/, "certifications stay");
    assert.match(resumePdfNote(result) ?? "", /^To keep it to one page, \d+ bullets? that matters? least for this role (was|were) left out: \d+ from .+\. Your résumé still has (it|them)\.$/);
  });

  it("keeps the bullets that use the role's words", async () => {
    const pavement = "Logged pavement condition ratings for 300 road segments";
    const plain = await onePageOf("civil-engineer-long-3p");
    assert.ok(plain.result.leftOut.some((b) => b.text.startsWith(pavement)), "the oldest role's last bullet goes first");
    // For a pavement-management role, the same bullet stays and another goes instead.
    const forPavement = await onePageOf("civil-engineer-long-3p", ["pavement", "condition", "asset"]);
    assert.equal(forPavement.result.pages, 1);
    assert.ok(forPavement.printed.includes(pavement));
    assert.equal(forPavement.result.leftOut.length, plain.result.leftOut.length);
  });
});

describe("remembered layouts on this device", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  const profile = (pageCount: number): ResumeLayoutProfile => ({
    version: 1, pageWidth: 612, pageHeight: 792, pageCount, marginLeft: 23, marginRight: 23, marginTop: 26, marginBottom: 26, bodySize: 7.75, lineHeight: 1.32,
    nameSize: 14, contactSize: 7.4, headingSize: 8.1, titleSize: 8.2, dateSize: 7.4, bulletIndent: 11.3, family: "sans", justified: true, centeredHeader: true,
  });
  const resume = (name: string, email: string): ResumeData => ({
    profile: { name, profession: "", yearsOfExperience: 0, location: "", email, phone: "" },
    experience: [], competencies: [], education: [], generatedSummary: "",
  });

  it("finds the layout for the same person by email, and stores neither email nor name", () => {
    rememberResumeLayout("Jane Doe\nToronto | jane@example.com\nSUMMARY\n…", profile(1));
    assert.equal(recallResumeLayout(resume("Jane Doe", "jane@example.com"))?.pageCount, 1);
    assert.equal(recallResumeLayout(resume("Jane Q. Doe", "JANE@example.com"))?.pageCount, 1, "email match, any case");
    const raw = store.get(RESUME_LAYOUTS_KEY)!;
    assert.doesNotMatch(raw, /jane|doe/i);
  });

  it("falls back to the name when the résumé has no email, and never dresses up someone else's résumé", () => {
    rememberResumeLayout("Jane Doe\nToronto\nSUMMARY\n…", profile(2));
    assert.equal(recallResumeLayout(resume("Jane Doe", ""))?.pageCount, 2);
    assert.equal(recallResumeLayout(resume("John Smith", "john@example.com")), null);
  });

  it("replaces the person's earlier layout when they upload again", () => {
    rememberResumeLayout("Jane Doe\njane@example.com", profile(2));
    rememberResumeLayout("Jane Doe\njane@example.com", profile(1));
    assert.equal(recallResumeLayout(resume("Jane Doe", "jane@example.com"))?.pageCount, 1);
    assert.equal(JSON.parse(store.get(RESUME_LAYOUTS_KEY)!).length, 1);
  });

  it("an upload remembers its layout as a side effect of reading the PDF", async () => {
    const bytes = fixture("accountant-a4-ragged");
    const { text } = await extractPDFTextInBrowser(bytes.slice().buffer);
    const data = resumeDataFromPlainText(text!);
    const recalled = recallResumeLayout(data);
    assert.ok(recalled, "remembered at upload");
    assert.equal(Math.round(recalled!.pageWidth), 595);
  });
});
