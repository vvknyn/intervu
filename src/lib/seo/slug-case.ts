/**
 * Routes whose `[slug]` is generated lowercase (`domainToSlug`, career-hub
 * slugs). A mixed-case request is the same page at a second URL, so the
 * middleware sends it to the lowercase one: one redirect rule for the class,
 * not a check inside each page. Listing a new generated-lowercase route here
 * is the only step needed to cover it.
 */
export const LOWERCASE_SLUG_PREFIXES = ["/co/", "/careers/"] as const;

/** The lowercase pathname when `pathname` is `<prefix><one mixed-case segment>`, else null. */
export function lowercaseSlugPath(pathname: string): string | null {
  const prefix = LOWERCASE_SLUG_PREFIXES.find((p) => pathname.startsWith(p));
  if (!prefix) return null;
  const slug = pathname.slice(prefix.length);
  if (!slug || slug.includes("/")) return null;
  const lower = slug.toLowerCase();
  return lower === slug ? null : prefix + lower;
}
