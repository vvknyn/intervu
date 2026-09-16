# Resume PDF verification (zip markdown → HTML/CSS → PDF)

## Pipeline

```
ResumeData (after tailor)
  → resumeDataToZipMarkdown              (inspectable only — Copy / /tmp/*.md)
  → resumeDataToParsedDocument           (structured, no markdown re-parse)
  → parsedResumeToZipHtml                (self-contained HTML + RESUME_ZIP_CSS)
  → PDF
```

**Do not** send zip markdown through `parseResumeContent` for Download. That path explodes `**Category:** a, b, c` into orphan `: skill` / `**:` lines.

**Browser download (one-click):** `exportZipResumePdfFromData(data)` builds HTML from `resumeDataToParsedDocument` → `parsedResumeToZipHtml`, mounts it in a same-document offscreen host (not an iframe), rasterizes with `html2canvas` (scale ≥ 2.5), and writes US Letter via jsPDF. Client-side only.

**Fallback:** `renderResumePdf(parsed)` using the **same** structured document. Never `parseResumeContent(markdown)`.

**Visual gold:** Playwright Chromium `page.pdf({ format: 'Letter' })` — Chrome/Skia.

## Generate golden sample + inspect markdown

```bash
npx tsx scripts/verify-resume-from-data.ts
# same gold path: npx tsx scripts/export-resume-zip-pdf.ts
```

Writes:

| Output | Path |
|--------|------|
| Inspectable markdown | `/tmp/resume-csm-golden.md` |
| Sample PDF | `test-resume-csm-golden.pdf` (repo root) |

The script asserts **page count === 1** and checks extracted text for Richmond Hill, competency categories, MITx, Buffalo, and absence of `Hands-on with` / `Skills:` dump.

The Playwright PDF is Chromium/Skia (`Producer: Skia/PDF`). Do not overwrite `test-resume-csm-golden.pdf` with the jsPDF fallback sample — that renderer writes `/tmp/test-resume-csm-golden-jspdf.pdf` when its unit test runs.

## Unit tests

```bash
npx tsx --test tests/unit/resume-zip-markdown.test.ts tests/unit/resume-zip-html.test.ts tests/unit/resume-zip-pdf.test.ts tests/unit/resume-to-markdown.test.ts tests/unit/local-customize-sheet.test.ts tests/unit/local-ai-tailor-resume.test.ts
```

jsPDF fallback renderer (unchanged):

```bash
npx tsx --test tests/unit/resume-render-pdf.test.ts
```

## Typography (`RESUME_ZIP_CSS` / `RESUME_PDF_TYPOGRAPHY`)

| Constant | Value |
|----------|-------|
| nameSize | 16pt, centered, bold |
| contactSize | 8.5pt, centered, pipe-delimited |
| headingSize | 9.5pt, ALL-CAPS, full-width 1px rule |
| bodySize | 9pt, line-height 1.15, left-aligned |
| page | US Letter 8.5×11in, padding ≈ 28pt 40pt |
| bullets | CSS `::before` circular disc (not Unicode) |

Body text uses normal word spacing — **no letter-spacing** on paragraphs or bullets.

## Visual checklist vs zip reference

Fixture: `tests/fixtures/vivek-csm-golden-resume.txt`

- [ ] Centered name
- [ ] Contact: `Richmond Hill, Ontario | phone | email | linkedin`
- [ ] ALL-CAPS section headers with full-width rules
- [ ] Bold `Category:` competency lines (no `Skills:` wrapper)
- [ ] Experience: `Title | Company` left, dates right
- [ ] Circular CSS bullets
- [ ] `EDUCATION & PROFESSIONAL DEVELOPMENT` heading
- [ ] Human CSM/TAM voice — no `Hands-on with` spam
- [ ] **One page** on Playwright Letter PDF (hard gate)

## Entry points using the HTML path

- `LocalCustomizePanel` — Copy uses zip markdown; Download uses `exportZipResumePdfFromData(draft.tailored)`
- `YourResumeSection` / `ResumeEditor` — `exportZipResumePdfFromData` when `ResumeData` is on hand
- `downloadResumeVersion` — free-text snapshots go through `resumeDataFromPlainText` then the same FromData exporter
