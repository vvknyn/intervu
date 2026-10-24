/** Where logos are served from: our own origin, never a third party. */
const LOGO_PATH_PREFIX = "/logos/";

/**
 * Canonical company-logo URL, keyed off a domain.
 *
 * Single chokepoint for the logo URL: `CompanyLogo`'s `<img>` tag and the
 * `/co/[slug]` Organization JSON-LD both read it from here. It is a
 * same-origin path ending in `.png` (Cloudflare caches by extension), served
 * by `app/logos/[file]/route.ts` via `lib/companies/logo-proxy.ts`, so the
 * visitor's browser never contacts a third party and no third party learns
 * which companies they view. The proxy passes upstream's HTTP 404 through
 * for a missing favicon, which `<img>` cannot otherwise tell apart from a
 * real 16px favicon — `CompanyLogo`'s `onError` then shows the letter tile.
 */
export function companyLogoUrl(domain: string): string {
  return `${LOGO_PATH_PREFIX}${encodeURIComponent(domain)}.png`;
}

/**
 * Pure: should `CompanyLogo` attempt the favicon `<img>` at all? `false` for
 * every way a logo can fail to render — no domain, an empty-string domain,
 * or `errored` already set by a prior load failure — covering the whole
 * class in one place instead of each caller re-deriving "is this domain
 * usable".
 */
export function shouldShowFavicon(domain: string | null, errored: boolean): boolean {
  return Boolean(domain) && !errored;
}
