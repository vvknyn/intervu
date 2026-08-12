/**
 * Pure digest assembly: cursors/counts/items in, a digest model (or null)
 * out — no Firestore, no search calls, no Date.now(). `collect.ts` is the
 * thin I/O layer that gathers the raw sections this consumes; `send.ts`
 * (digest) is the thin sender that renders and dispatches whatever this
 * returns. Kept fully I/O-free so every branch (empty digest, one section,
 * capped items, multiple sections) is a plain unit test.
 */
export interface DigestSectionItem {
  title: string;
  company: string;
  href: string;
}

export interface RawDigestSection {
  kind: "followed-company" | "saved-search";
  name: string;
  /** Newest-first, already filtered to "since the cursor" — NOT yet capped
   *  for display. */
  items: DigestSectionItem[];
  /** True when the upstream fetch hit its own limit (see
   *  JOBS_FETCHED_PER_FOLLOW_DOMAIN / JOBS_FETCHED_PER_SAVED_SEARCH) — so
   *  `items.length` is a known FLOOR on how many are actually new, not
   *  necessarily the exact count. The template renders "5+" instead of "5"
   *  when true, rather than ever stating a number that might undercount. */
  mayHaveMore: boolean;
  /** Deep link to the exact filtered board view for "see all". */
  seeAllHref: string;
}

export interface DigestSection extends Omit<RawDigestSection, "items"> {
  /** Capped to `itemCap` for display. */
  items: DigestSectionItem[];
  /** The real number of new items found (pre-cap) — never fabricated,
   *  always `<=` what was actually fetched. */
  totalNew: number;
}

export interface DigestModel {
  sections: DigestSection[];
  unsubscribeUrl: string;
}

export interface AssembleDigestInput {
  sections: RawDigestSection[];
  unsubscribeUrl: string;
  itemCap?: number;
}

export const DEFAULT_DIGEST_ITEM_CAP = 5;

/**
 * Empty sections are dropped entirely (a followed company or saved search
 * with nothing new doesn't earn a place in the email); if that leaves zero
 * sections, returns null — "skip users with zero new items entirely," per
 * the product rule that a hollow digest must never send.
 */
export function assembleDigest(input: AssembleDigestInput): DigestModel | null {
  const cap = input.itemCap ?? DEFAULT_DIGEST_ITEM_CAP;

  const sections: DigestSection[] = input.sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      ...section,
      items: section.items.slice(0, cap),
      totalNew: section.items.length,
    }));

  if (sections.length === 0) return null;

  return { sections, unsubscribeUrl: input.unsubscribeUrl };
}
