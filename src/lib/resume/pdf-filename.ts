/**
 * Kept apart from render-pdf.ts so the pages that only need a download's
 * file name (the jobs list's For you view, the customize panel, the résumé
 * editor) don't import jsPDF just to build a string. jsPDF is about 135 KB
 * gzipped and is only needed when a PDF is actually drawn.
 */

/** Pure: `<Company>-<Role>-resume-<YYYY-MM-DD>` (no extension — the caller
 *  appends it), matching the founder's reference filename convention
 *  (Indigo-Digital-Product-Manager-resume-2026-08-07.pdf). Falls back
 *  gracefully when pursuit metadata is absent (a base-résumé download has
 *  no company/role at all) rather than producing an empty/broken name. */
export function deriveResumePdfFilename(meta: {
  company?: string | null;
  role?: string | null;
  fallbackLabel?: string | null;
  dateIso: string;
}): string {
  const slug = (s: string) =>
    s
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  const company = meta.company ? slug(meta.company) : "";
  const role = meta.role ? slug(meta.role) : "";
  const stem = company && role ? `${company}-${role}` : company || role || (meta.fallbackLabel ? slug(meta.fallbackLabel) : "") || "resume";
  const date = /^\d{4}-\d{2}-\d{2}/.test(meta.dateIso) ? meta.dateIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${stem}-resume-${date}`;
}
