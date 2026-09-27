# Resume PDF verification (zip HTML → Chromium/Skia text PDF)

## Pipeline

```
ResumeData (after tailor)
  → resumeDataToZipMarkdown              (inspectable only — Copy / /tmp/*.md)
  → resumeDataToParsedDocument           (structured, no markdown re-parse)
  → parsedResumeToZipHtml                (semantic h1/h2/p/ul/li + RESUME_ZIP_CSS)
  → Chromium/Skia print-to-pdf           (Playwright page.pdf /api/resume/pdf)
```

**Do not** send zip markdown through `parseResumeContent` for Download. That path explodes `**Category:** a, b, c` into orphan `: skill` / `**:` lines.

**Browser download (one-click):** `exportZipResumePdfFromData(data)` builds HTML from `resumeDataToParsedDocument` → `parsedResumeToZipHtml`, POSTs to `/api/resume/pdf` (Playwright Chromium `page.pdf`, Producer: Skia/PDF — real selectable text). Client-side only for structuring; print runs on the Node API.

**Fallback:** text `renderResumePdf(parsed)` (jsPDF core Helvetica, extractable text). **Never** html2canvas image PDFs. Never `parseResumeContent(markdown)`.

**Visual gold / local proof:** same HTML → `htmlToChromePdf` (Playwright).

## Typography (`RESUME_ZIP_CSS`)

| Constant | Value |
|----------|-------|
| font | `"Helvetica Neue", Helvetica, Arial, sans-serif` |
| bodySize | ~9.2pt, line-height 1.15 |
| nameSize | 16pt, centered, bold |
| contactSize | 8.5pt, centered, pipe-delimited |
| headingSize | 9.5pt, ALL-CAPS, full-width 1px rule |
| @page | Letter; margins ~0.34in 0.46in 0.28in 0.46in |
| bullets | CSS `::before` circular disc (not Unicode) |
| entry row | flex title \| date |

Body text uses normal word spacing — **no letter-spacing** on paragraphs or bullets.

Product name in user-facing copy: **velai.app** (never intervu.cc).

## Soft-fail empty extractable text

Upload/parse (`extractResumeFileText` / `extractPDFTextInBrowser`): if extractable text is empty (image-only / scanned / old jsPDF raster dumps), throw a re-upload / paste message — never pretend success with a blank résumé.

`/api/resume/pdf` also rejects generated PDFs with no extractable text (422).

## Generate golden sample + inspect markdown

```bash
npx tsx scripts/export-resume-zip-pdf.ts
# same gold path: npx tsx scripts/verify-resume-from-data.ts
```

Writes:

| Output | Path |
|--------|------|
| Inspectable markdown | `/tmp/resume-csm-golden.md` |
| Sample PDF | `test-resume-csm-golden.pdf` (repo root) |

The script asserts **page count === 1** and checks extracted text for Richmond Hill, competency categories, MITx, Buffalo, and absence of `Hands-on with` / `Skills:` dump.

Local packs-home proof artifacts: `.velai-packs-home-local/s-resume-text-pdf.pdf` (+ `.png` screenshot, `.txt` pdftotext).

## Unit tests

```bash
npx tsx --test tests/unit/resume-zip-markdown.test.ts tests/unit/resume-zip-html.test.ts tests/unit/resume-zip-pdf.test.ts tests/unit/resume-to-markdown.test.ts tests/unit/local-customize-sheet.test.ts tests/unit/local-ai-tailor-resume.test.ts
```

jsPDF text fallback renderer:

```bash
npx tsx --test tests/unit/resume-render-pdf.test.ts
```

## Visual checklist vs zip / Job Apply reference

Fixture: `tests/fixtures/vivek-csm-golden-resume.txt`

- [ ] Centered name
- [ ] Contact: `Richmond Hill, Ontario | phone | email | linkedin`
- [ ] ALL-CAPS section headers with full-width rules
- [ ] Bold `Category:` competency lines (no `Skills:` wrapper)
- [ ] Experience: `Title | Company` left, dates right (flex `.row`)
- [ ] Circular CSS bullets
- [ ] `EDUCATION & PROFESSIONAL DEVELOPMENT` heading
- [ ] Human CSM/TAM voice — no `Hands-on with` spam
- [ ] **One page** on Playwright Letter PDF (hard gate)
- [ ] `pdftotext` extracts real selectable text (not image-only)

## Entry points using the HTML → Chrome text-PDF path

- `LocalCustomizePanel` — Copy uses zip markdown; Download uses `exportZipResumePdfFromData(draft.tailored)`
- `ForYouHome` — tailored download
- `YourResumeSection` / `ResumeEditor` — `exportZipResumePdfFromData` when `ResumeData` is on hand
- `downloadResumeVersion` — free-text snapshots go through `resumeDataFromPlainText` then the same FromData exporter
