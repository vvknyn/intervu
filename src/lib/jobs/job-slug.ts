import type { PublicJob } from "./types";

const UUID_TAIL = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BARE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugifyPart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Canonical path for a job. The slug is decorative; the trailing uuid is authoritative. */
export function jobPath(job: Pick<PublicJob, "id" | "title" | "company">): string {
  const parts = [slugifyPart(job.title)];
  const company = job.company ? slugifyPart(job.company) : "";
  if (company) parts.push("at", company);
  const slug = parts.filter(Boolean).join("-");
  return slug ? `/jobs/${slug}-${job.id}` : `/jobs/${job.id}`;
}

/** Extracts the authoritative uuid from a slug segment. Null when absent/malformed. */
export function parseJobSlug(slug: string): string | null {
  const match = UUID_TAIL.exec(slug);
  if (match) return match[1].toLowerCase();
  // A bare uuid with no descriptive prefix is still a legal, canonical-redirectable URL.
  return BARE_UUID.test(slug) ? slug.toLowerCase() : null;
}
