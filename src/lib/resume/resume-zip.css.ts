/** Matches `RESUME_PDF_TYPOGRAPHY` in render-pdf.ts — duplicated here so CSS
 *  imports never pull jsPDF into Node/HTML-only test paths. */
const TYPO = {
    nameSize: 16,
    contactSize: 8.5,
    headingSize: 9.5,
    bodySize: 9,
    lineHeight: 1.15,
    bulletIndent: 12,
    ruleGapBelowText: 3,
    sectionGapBefore: 8,
    gapAfterHeadingRule: 4,
    gapBetweenBlocks: 3,
    gapEntryTitleToBullets: 2,
    marginTop: 28,
    marginBottom: 28,
    marginX: 40,
} as const;

/** Dedicated CSS for zip-style résumé HTML — not app Tailwind. */
export const RESUME_ZIP_CSS = `
@page {
  size: letter;
  margin: 0;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  background: #ffffff;
  color: #111111;
}

body {
  font-family: Calibri, Carlito, "Segoe UI", Arial, Helvetica, sans-serif;
  font-size: ${TYPO.bodySize}pt;
  line-height: ${TYPO.lineHeight};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.resume-page {
  width: 8.5in;
  min-height: 11in;
  margin: 0 auto;
  padding: ${TYPO.marginTop}pt ${TYPO.marginX}pt ${TYPO.marginBottom}pt;
  background: #ffffff;
}

.resume-name {
  font-size: ${TYPO.nameSize}pt;
  font-weight: 700;
  text-align: center;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin-bottom: 2pt;
}

.resume-contact {
  font-size: ${TYPO.contactSize}pt;
  text-align: center;
  line-height: 1.2;
  margin-bottom: ${TYPO.sectionGapBefore}pt;
}

.resume-section {
  margin-top: ${TYPO.sectionGapBefore}pt;
}

.resume-section:first-of-type {
  margin-top: 0;
}

.resume-section > h2 {
  font-size: ${TYPO.headingSize}pt;
  font-weight: 700;
  // design-lint-allow
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.1;
  border-bottom: 1px solid #111111;
  padding-bottom: ${TYPO.ruleGapBelowText}pt;
  margin-bottom: ${TYPO.gapAfterHeadingRule}pt;
}

.resume-paragraph {
  text-align: left;
  word-spacing: normal;
  margin-bottom: ${TYPO.gapBetweenBlocks}pt;
}

.resume-competency {
  text-align: left;
  word-spacing: normal;
  margin-bottom: ${TYPO.gapBetweenBlocks}pt;
}

.resume-competency strong {
  font-weight: 700;
}

.resume-entry {
  margin-bottom: ${TYPO.gapBetweenBlocks}pt;
}

.resume-entry-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8pt;
  margin-bottom: ${TYPO.gapEntryTitleToBullets}pt;
}

.resume-entry-title {
  font-weight: 700;
  flex: 1 1 auto;
  min-width: 0;
}

.resume-entry-dates {
  font-weight: 400;
  flex: 0 0 auto;
  white-space: nowrap;
  text-align: right;
}

.resume-bullets {
  list-style: none;
  padding-left: ${TYPO.bulletIndent}pt;
  margin: 0;
}

.resume-bullets li {
  position: relative;
  text-align: left;
  word-spacing: normal;
  margin-bottom: ${TYPO.gapBetweenBlocks}pt;
  padding-left: 8pt;
}

.resume-bullets li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #111111;
  transform: translateY(-50%);
}

.resume-bullets li:last-child {
  margin-bottom: 0;
}
`.trim();
