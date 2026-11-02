/**
 * Every page route in src/app and what the phone wrapping audit (journey J-MOB-33, phone-wrap.spec.ts) measures for
 * it, so no page is left out by being forgotten: tests/unit/phone-wrap.test.ts fails when a route is missing here or
 * a fixture listed here is gone.
 *
 * `audit` lists the paths asked at 390 and 320. A path under /mock is a fixture: the real page body over made-up
 * data, for a page that draws its rows only when the search index or the box database answers (neither is reachable
 * from a cloud session, which would otherwise audit the "data isn't available" page). `skip` says why a route has no
 * audit, and is a reason to read, not a place to park a failure.
 */
export type WrapRoute = { audit: string[] } | { skip: string };

/** A sample of each dynamic segment, kept in step with the registries by the unit test. */
export const SAMPLE_BLOG_SLUG = "velai-vs-jobshifu";
export const SAMPLE_CAREER_SLUG = "remote-jobs";

export const WRAP_ROUTES: Record<string, WrapRoute> = {
    "/": { audit: ["/"] },
    "/about": { audit: ["/about"] },
    "/account": { audit: ["/account"] },
    "/admin": { skip: "owner-only; no page a visitor sees" },
    "/auth/retry": { audit: ["/auth/retry"] },
    "/auth/verify-email": { audit: ["/auth/verify-email"] },
    "/billing/return": { audit: ["/billing/return"] },
    "/blog": { audit: ["/blog"] },
    "/blog/[slug]": { audit: [`/blog/${SAMPLE_BLOG_SLUG}`] },
    "/careers/[slug]": { audit: [`/careers/${SAMPLE_CAREER_SLUG}`, "/mock/career-hub"] },
    "/co": { skip: "the company directory reads the box database (500 on a cloud server)" },
    "/co/[slug]": { audit: ["/mock/company-page"] },
    "/co/letter/[letter]": { skip: "the directory's letter page reads the box database (500 on a cloud server)" },
    "/companies/[slug]": { skip: "a fallback for a company with no known domain; it reads the search index" },
    "/companies/hiring": { audit: ["/companies/hiring"] },
    "/connect": { audit: ["/connect"] },
    "/connect/help": { audit: ["/connect/help"] },
    "/contact": { audit: ["/contact"] },
    "/eluta-alternative": { audit: ["/eluta-alternative"] },
    "/indeed-alternative": { audit: ["/indeed-alternative"] },
    "/jobs": { audit: ["/jobs"] },
    "/jobs/[slug]": { skip: "the job detail's MetaLine keeps its dot at a line's end by contract (J-MOB-24/26)" },
    "/jobs/first-rows": { audit: ["/jobs/first-rows"] },
    "/jobs/front-door": { audit: ["/jobs/front-door"] },
    "/linkedin-jobs-alternative": { audit: ["/linkedin-jobs-alternative"] },
    "/login": { audit: ["/login"] },
    "/oauth/authorize": { skip: "needs an authorization request from a connecting app" },
    "/openclaw": { audit: ["/openclaw"] },
    "/pricing": { audit: ["/pricing"] },
    "/privacy": { audit: ["/privacy"] },
    "/research/ghost-jobs": { audit: ["/research/ghost-jobs"] },
    "/reset-password": { audit: ["/reset-password"] },
    "/resume": { skip: "signed in: audited by J-MOB-34 (a stored résumé, and a guest's résumé on this device)" },
    "/settings": { skip: "signed in: /mock/settings draws only its \"Couldn't load\" state on a server with no box database; the résumé tab is audited by J-MOB-34" },
    "/stories": { audit: ["/stories"] },
    "/terms": { audit: ["/terms"] },
    "/trends": { audit: ["/trends", "/mock/trends"] },
    "/watch/[id]": { skip: "a signed-in watch; no fixture yet" },
    "/watch/anywhere": { audit: ["/watch/anywhere"] },
    "/yours": { audit: ["/yours"] },
    "/yours/[id]": { skip: "a signed-in pursuit; no fixture yet" },
    "/yours/history": { audit: ["/mock/history"] },
};

/** What a fixture must have drawn before it is measured: each fixture's reason to exist is a section that only data draws. */
export const WRAP_FIXTURE_READY: Record<string, string[]> = {
    "/mock/trends": ["trends-pulse-coverage", "trends-work-types", "trends-experience-levels"],
    "/mock/career-hub": ["career-hub-total", "career-hub-companies", "career-hub-roles"],
    "/mock/company-page": ["company-section-identity"],
};

export const isFixture = (path: string) => path.startsWith("/mock/");

export const auditedPaths = (): string[] => [...new Set(Object.values(WRAP_ROUTES).flatMap((r) => ("audit" in r ? r.audit : [])))];
