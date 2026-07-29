import { getBoardDomains } from "./allowlists";
import type { BoardId } from "./types";
import { BOARD_META } from "./types";

/**
 * Reversible domain ↔ URL slug encoding for `/co/[slug]`.
 *
 * Scheme: lowercase domain with each `.` replaced by `--`.
 * Example: `rad-ai.com` → `rad-ai-com`. Raw dots are unsafe in Next.js
 * dynamic segments; `--` is unambiguous because hostnames never contain it.
 */
export function domainToSlug(domain: string): string {
  return domain.trim().toLowerCase().replace(/\./g, "--");
}

/** Mechanical inverse of `domainToSlug`; does not validate membership. */
export function decodeSlug(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (!s || !s.includes("--")) return null;
  const domain = s.replace(/--/g, ".");
  if (!domain.includes(".")) return null;
  return domain;
}

/** Resolve a slug to a known board domain, or null when not on any allowlist. */
export function slugToDomain(slug: string): string | null {
  const domain = decodeSlug(slug);
  if (!domain) return null;
  return getBoardsForDomain(domain).length > 0 ? domain : null;
}

export function getBoardsForDomain(domain: string): BoardId[] {
  const normalized = domain.trim().toLowerCase();
  return (Object.keys(BOARD_META) as BoardId[]).filter((id) =>
    getBoardDomains(id).includes(normalized),
  );
}
