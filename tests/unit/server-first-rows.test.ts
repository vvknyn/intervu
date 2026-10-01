import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    FIRST_ROWS_PATH,
    formatsNumbersLikeServer,
    isPhoneRequest,
    isUsableFirstRows,
    shouldServeFirstRows,
    type FirstRowsRequest,
} from "../../src/lib/jobs/server-first-rows";
import { parseJobSlug } from "../../src/lib/jobs/job-slug";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET =
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const DESKTOP_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function phoneLanding(overrides: Partial<FirstRowsRequest> = {}, search = "?q=nurse", headers: Record<string, string> = {}): FirstRowsRequest {
    return {
        method: "GET",
        pathname: "/jobs",
        searchParams: new URLSearchParams(search),
        headers: new Headers({ "user-agent": ANDROID_CHROME, "sec-fetch-dest": "document", ...headers }),
        signedIn: false,
        isBot: false,
        ...overrides,
    };
}

test("a phone is told apart from a tablet and a desktop", () => {
    assert.equal(isPhoneRequest(new Headers({ "user-agent": ANDROID_CHROME })), true);
    assert.equal(isPhoneRequest(new Headers({ "user-agent": IPHONE_SAFARI })), true);
    assert.equal(isPhoneRequest(new Headers({ "user-agent": ANDROID_TABLET })), false, "tablets get the wide layout");
    assert.equal(isPhoneRequest(new Headers({ "user-agent": DESKTOP_CHROME })), false);
    assert.equal(isPhoneRequest(new Headers({ "user-agent": DESKTOP_CHROME, "sec-ch-ua-mobile": "?1" })), true, "the client hint wins");
    assert.equal(isPhoneRequest(new Headers()), false);
});

test("a signed-out phone opening a search link gets the first rows from the server", () => {
    assert.equal(shouldServeFirstRows(phoneLanding()), true);
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse&country=CA&sort=newest")), true);
    // Older browsers don't send Sec-Fetch-Dest; a plain document request still counts.
    assert.equal(shouldServeFirstRows({ ...phoneLanding(), headers: new Headers({ "user-agent": IPHONE_SAFARI }) }), true);
});

test("everyone else keeps the prerendered /jobs", () => {
    assert.equal(shouldServeFirstRows(phoneLanding({ signedIn: true })), false, "signed in");
    assert.equal(shouldServeFirstRows(phoneLanding({ isBot: true })), false, "crawlers and link previews");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { "user-agent": DESKTOP_CHROME })), false, "desktop");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { "user-agent": ANDROID_TABLET })), false, "tablet");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "")), false, "bare /jobs shows no list until there is a reason");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=%20")), false, "blank query");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?country=CA")), false, "filters only");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse&job=abc")), false, "a shared job opens that job first");
    assert.equal(shouldServeFirstRows(phoneLanding({ method: "POST" })), false, "server actions post to /jobs");
    assert.equal(shouldServeFirstRows(phoneLanding({ method: "HEAD" })), false);
    assert.equal(shouldServeFirstRows(phoneLanding({ pathname: "/jobs/some-role-1" })), false);
    assert.equal(shouldServeFirstRows(phoneLanding({ pathname: "/" })), false);
});

test("client navigations, prefetches and fetches keep the prerendered page and its prefetch", () => {
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { rsc: "1" })), false, "client navigation");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { rsc: "1", "next-router-prefetch": "1" })), false, "prefetch");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { "next-action": "abc" })), false, "server action");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { "sec-fetch-dest": "empty" })), false, "fetch()");
    assert.equal(shouldServeFirstRows(phoneLanding({}, "?q=nurse", { "sec-fetch-dest": "iframe" })), false);
});

test("rows are rendered only for a browser that writes numbers the way the server does", () => {
    const serverLocale = new Intl.NumberFormat().resolvedOptions().locale;
    assert.equal(formatsNumbersLikeServer(serverLocale), true);
    assert.equal(formatsNumbersLikeServer(`${serverLocale},fr;q=0.8`), true, "the first preference decides");
    // German groups with dots and French with spaces: the board's counts would not match on hydration.
    for (const other of ["de-DE", "fr-FR"]) {
        const differs = new Intl.NumberFormat(other).format(1234567.5) !== (1234567.5).toLocaleString();
        assert.equal(formatsNumbersLikeServer(`${other},en;q=0.5`), !differs, other);
    }
    assert.equal(formatsNumbersLikeServer(null), false, "unknown");
    assert.equal(formatsNumbersLikeServer(""), false);
    assert.equal(formatsNumbersLikeServer("*"), false);
    assert.equal(formatsNumbersLikeServer("not a locale!!"), false, "a malformed header");
});

test("only real rows are worth rendering", () => {
    assert.equal(isUsableFirstRows({ hits: [{}] }), true);
    assert.equal(isUsableFirstRows({ hits: [] }), false, "no rows: the empty state stays the browser's");
    assert.equal(isUsableFirstRows({ hits: [{}], unavailable: true }), false, "outage or rate limit");
    assert.equal(isUsableFirstRows({ hits: [{}], meta: { gated: true } }), false);
    assert.equal(isUsableFirstRows(null), false, "over the time budget");
});

test("the rewrite target can never be a job's page", () => {
    assert.equal(FIRST_ROWS_PATH.startsWith("/jobs/"), true);
    assert.equal(parseJobSlug(FIRST_ROWS_PATH.slice("/jobs/".length)), null);
});

test("the middleware rewrites AuthKit's own response and sends direct visits back to /jobs", () => {
    const src = read("src/middleware.ts");
    const redirect = src.indexOf("if (pathname === FIRST_ROWS_PATH)");
    const authkitCall = src.indexOf("authkit(request)");
    const authkitResponse = src.indexOf("const response = handleAuthkitHeaders(request, headers);");
    const decision = src.indexOf("shouldServeFirstRows({");
    assert.ok(redirect > 0 && redirect < authkitCall, "direct visits are bounced before AuthKit runs");
    assert.ok(decision > authkitResponse, "decided once the session is known, on AuthKit's response");
    assert.match(src, /signedIn: !!session\.user/);
    assert.match(src, /return firstRows \? asRewrite\(response, request, FIRST_ROWS_PATH\) : response;/);
    // Its forwarded request headers, cookies and robots header carry over.
    assert.match(src, /NextResponse\.rewrite\(url, \{ headers: response\.headers \}\)/);
    assert.match(src, /rewrite\.headers\.delete\("x-middleware-next"\)/);
});

test("the server-rendered page searches with the list's own first-search params and passes them on", () => {
    const page = read("src/app/jobs/first-rows/page.tsx");
    assert.match(page, /earlyFirstSearchParams\(`\?\$\{search\.toString\(\)\}`, false\)/);
    assert.match(page, /searchJobsAction\(params\)/);
    assert.match(page, /FIRST_ROWS_SEARCH_BUDGET_MS/);
    assert.match(page, /<JobsRouteGate initialSearch=\{/);

    const gate = read("src/app/jobs/JobsRouteGate.tsx");
    assert.match(gate, /startEarlyFirstSearch\(initialSearch\.params, \(\) => Promise\.resolve\(initialSearch\.result\)\)/);
    assert.match(gate, /if \(!mounted && !initialSearch\) return null;/);

    const content = read("src/app/jobs/JobsContent.tsx");
    assert.match(content, /useState\(\(\) => initialSearch\?\.now \?\? Date\.now\(\)\)/, "ages read against the server's instant");
    assert.match(content, /hits: interleaveByCompany\(initialSearch\.result\.hits\)/, "rows in the order the search effect stores them");
});
