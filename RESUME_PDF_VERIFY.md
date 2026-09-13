# Resume PDF verification (CSM golden zip)

## Typography (`RESUME_PDF_TYPOGRAPHY`)

| Constant | Value |
|----------|-------|
| nameSize | 16 |
| contactSize | 8.5 |
| headingSize | 9.5 |
| bodySize | 9 |
| lineHeight | 1.15 |
| marginX | 40 |
| marginTop / marginBottom | 28 |
| sectionGapBefore | 8 |
| gapAfterHeadingRule | 4 |
| gapBetweenBlocks | 3 |
| descentPad | 3 |

## CSM golden layout (jsPDF measurer)

Run: `npx tsx --test tests/unit/resume-render-pdf.test.ts` (describe: `vivek-csm-golden-resume zip fixture`).

- **pages.length**: 1
- **lastBaseline**: 718.83 pt (page limit 761 pt — 42.17 pt clearance)
- **Contact line**: `Richmond Hill, Ontario | +1 (437)-224-8332 | viveknyan@gmail.com | linkedin.com/in/viveknar`
- **Competency labels**: Customer Success & Account Management; Delivery & Process Excellence; Platforms & Tools
- **Sample PDF**: `/workspace/test-resume-csm-golden.pdf`
