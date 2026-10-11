import { test as base, type TestInfo } from "@playwright/test";
import { POSTHOG_PROXY_PATH } from "../../../src/lib/posthog-options";

/**
 * Journey-suite fixtures. Every journey test gets, automatically:
 *  - analytics + first-party telemetry blocked (a regression run must not
 *    pollute PostHog or write rows into the prod telemetry table);
 *  - sealed AI (Tinfoil) read as off: a run never spends the Tinfoil key or
 *    depends on a model's answer. A journey that checks the sealed-AI path
 *    puts a stub on `window.__velaiSealedAi` (src/lib/sealed-ai/client.ts);
 *  - console errors, uncaught page errors and same-origin >=500 responses
 *    collected, attached to the report, and exposed as `diagnostics` so a spec
 *    can assert on them.
 */

const ANALYTICS_HOST_SUFFIXES = ["posthog.com", "cloudflareinsights.com"];
const ANALYTICS_PATH_PREFIXES = [`${POSTHOG_PROXY_PATH}/`, "/api/telemetry", "/cdn-cgi/rum"];

/** Pure: is this request analytics/telemetry traffic that a journey run must not send? */
export function isAnalyticsRequest(url: URL, origin: string): boolean {
  if (ANALYTICS_HOST_SUFFIXES.some((s) => url.hostname === s || url.hostname.endsWith(`.${s}`))) return true;
  return (
    url.origin === origin &&
    ANALYTICS_PATH_PREFIXES.some((p) => (p.endsWith("/") ? url.pathname.startsWith(p) : url.pathname === p))
  );
}

/** Pure: is this a request to velai.app's sealed-AI routes? */
export function isSealedAiRequest(url: URL, origin: string): boolean {
  return url.origin === origin && url.pathname.startsWith("/api/sealed-ai/");
}

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
  analyticsAborted: string[];
}

async function attachDiagnostics(testInfo: TestInfo, d: Diagnostics) {
  await testInfo.attach("diagnostics.json", { body: JSON.stringify(d, null, 2), contentType: "application/json" });
  // Surfaced in the json reporter so a run can prove blocking happened.
  testInfo.annotations.push({ type: "analytics-aborted", description: String(d.analyticsAborted.length) });
}

export const test = base.extend<{ diagnostics: Diagnostics }>({
  diagnostics: [
    async ({ page, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL ?? "http://localhost:3000").origin;
      const d: Diagnostics = { consoleErrors: [], pageErrors: [], serverErrors: [], analyticsAborted: [] };

      await page.context().route(
        (url) => isAnalyticsRequest(url, origin),
        (route) => {
          d.analyticsAborted.push(route.request().url());
          return route.abort();
        },
      );
      await page.context().route(
        (url) => isSealedAiRequest(url, origin),
        (route) =>
          new URL(route.request().url()).pathname === "/api/sealed-ai/status"
            ? route.fulfill({ json: { enabled: false, model: "" } })
            : route.abort(),
      );
      page.on("console", (m) => {
        // An aborted analytics request logs "Failed to load resource" — our own doing, not a finding.
        if (m.type() !== "error" || isAnalyticsRequest(new URL(m.location().url || origin), origin)) return;
        d.consoleErrors.push(m.text());
      });
      page.on("pageerror", (e) => d.pageErrors.push(e.message));
      page.on("response", (r) => {
        if (r.status() >= 500 && new URL(r.url()).origin === origin) d.serverErrors.push(`${r.status()} ${r.url()}`);
      });

      await use(d);
      await attachDiagnostics(testInfo, d);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
