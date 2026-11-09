/**
 * Where "home" is. `/` has no page of its own: it permanently redirects to
 * `/jobs` (src/app/page.tsx, plus the `?q=` rule in next.config.ts), because the
 * front door IS the job board. A link to `/` therefore costs every visitor and
 * every crawler a 308 before the page they wanted, on every page that carries
 * it (the logo is on all of them). Link to the final address instead.
 *
 * tests/unit/internal-links.test.ts fails when a link in src/ points at `/`, or
 * at any other address that redirects.
 */
export const HOME_PATH = "/jobs" as const;
