/**
 * The one address scrubber: PostHog's `before_send` (posthog-options.ts) and the telemetry ledger's ingest
 * (lib/telemetry/ingest.ts) both call `scrubValue`, so what one sink drops the other drops.
 */

/**
 * A page or link address with no query string and no hash. A query can carry
 * the words searched (`?q=`), the résumé's role titles (`sort=fit`), a nested
 * copy of either (`/login?next=%2Fjobs%3Fq%3D...`) or a bearer token
 * (`?token=`), and a hash can carry the same. None of it is needed for
 * analytics, so every address loses both, whatever the key. Absolute and
 * site-relative addresses are handled; anything else comes back unchanged.
 */
export function withoutQueryAndHash(value: string): string {
  if (!/[?#]/.test(value)) return value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return value;
    }
  }
  // Site-relative: no host needed, cut at the first `?` or `#`.
  return value.startsWith("/") && !value.startsWith("//") ? value.slice(0, value.search(/[?#]/)) : value;
}

/** A string property: each link inside a click's `$elements_chain` (`a:href="/jobs?q=nurse"...`) cleaned, then the whole value if it is itself an address. */
function scrubString(value: string): string {
  const chain = value.includes('href="')
    ? value.replace(/(href|attr__href)="([^"]*)"/g, (_match, attr: string, href: string) => `${attr}="${withoutQueryAndHash(href)}"`)
    : value;
  return withoutQueryAndHash(chain);
}

/** Strings anywhere in a property value, arrays (`$elements`) and nested objects included. */
export function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, scrubValue(inner)]));
  }
  return value;
}
