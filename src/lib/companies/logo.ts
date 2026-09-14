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
 * Below this intrinsic pixel width, a loaded favicon is Google's generic
 * fallback glyph, not a real one.
 *
 * When `s2/favicons` has no real favicon for a domain it still responds
 * HTTP 200 with a validly-decodable image — a fixed ~16px generic globe
 * icon — regardless of the requested `sz`. `<img onerror>` never fires for
 * this case (the load genuinely succeeded), which is why some `/jobs` rows
 * rendered a blank tile with no visible fallback: the component believed it
 * had a real logo. `naturalWidth` is intrinsic pixel data the browser always
 * exposes once an image decodes — unlike pixel content, it isn't blocked by
 * a no-referrer/cross-origin load — so it's a safe, class-wide signal for
 * "no real icon" that needs no per-domain knowledge. A real favicon Google
 * does have is served at native resolution, always well above this floor for
 * a `sz=128` request.
 */
export const MIN_REAL_FAVICON_PX = 32;

/** Pure: does a loaded favicon's intrinsic width mark it as Google's generic
 *  fallback glyph rather than a real logo? */
export function isPlaceholderFavicon(naturalWidth: number): boolean {
  return naturalWidth > 0 && naturalWidth < MIN_REAL_FAVICON_PX;
}

/**
 * Pure: should `CompanyLogo` attempt the favicon `<img>` at all? `false` for
 * every way a logo can fail to render — no domain, an empty-string domain,
 * or `errored` already set by a prior load failure/placeholder detection —
 * covering the whole class in one place instead of each caller re-deriving
 * "is this domain usable".
 */
export function shouldShowFavicon(domain: string | null, errored: boolean): boolean {
  return Boolean(domain) && !errored;
}
