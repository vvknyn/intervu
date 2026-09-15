/**
 * Canonical company-logo URL, keyed off a domain.
 *
 * Single chokepoint for the favicon URL formula: `CompanyLogo`'s `<img>` tag
 * and the `/co/[slug]` Organization JSON-LD both read a company's logo URL
 * from here, so the tile a visitor sees and the URL a crawler indexes can
 * never name two different logo sources for the same domain.
 */
export function companyLogoUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

/**
 * No-favicon and real-favicon cases can't be told apart from the browser's
 * `<img>` element: Google answers a missing favicon with HTTP 404 plus one
 * fixed 16px glyph, but plenty of real favicons (e.g. cisco.com) are also
 * genuinely 16px and answer HTTP 200 — and Chromium decodes both, so
 * `onLoad`/`naturalWidth` see the same thing either way. The only honest
 * signal is the HTTP status, which `<img>` never exposes; the real fix is a
 * status-aware proxy in front of this URL, not a client-side size guess.
 */

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
