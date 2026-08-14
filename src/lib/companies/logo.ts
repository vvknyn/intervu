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
