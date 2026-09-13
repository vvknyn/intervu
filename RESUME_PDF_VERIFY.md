# Resume PDF verification (zip markdown → HTML/CSS → PDF)

## Pipeline

```
ResumeData (after tailor)
  → resumeDataToZipMarkdown   (inspectable zip-shaped markdown)
  → parseResumeContent        (same parser as free-text variants)
  → zipMarkdownToHtml         (self-contained HTML + RESUME_ZIP_CSS)
  → PDF
```

**Browser download (one-click):** `exportZipResumePdf` mounts the HTML in a hidden iframe, rasterizes with `html2canvas` (scale ≥ 2.5), and writes US Letter via jsPDF. Client-side only — résumé content never leaves the device.

**Visual gold / sample PDF:** Playwright Chromium `page.setContent(html)` + `page.pdf({ format: 'Letter', printBackground: true, margin: 0 })` — Chrome/Skia, same engine family as the zip reference.

**Fallback:** If the HTML path throws, `exportZipResumePdf` falls back to `renderResumePdf(parseResumeContent(markdown))` (jsPDF draw commands). The legacy renderer remains in `src/lib/resume/render-pdf.ts`.

## Generate golden sample + inspect markdown

```bash
npx tsx scripts/export-resume-zip-pdf.ts
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

- `LocalCustomizePanel` — Copy + Download PDF (`resumeDataToZipMarkdown` → `exportZipResumePdf`)
- `YourResumeSection` — base résumé Download PDF
- `ResumeEditor` — Download PDF
- `downloadResumeVersion` — pursuit variant downloads
