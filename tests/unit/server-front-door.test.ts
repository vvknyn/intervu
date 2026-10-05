import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FRONT_DOOR_PATH, shouldServeFrontDoor, type FrontDoorRequest } from "../../src/lib/jobs/server-front-door";
import { FIRST_ROWS_PATH, shouldServeFirstRows } from "../../src/lib/jobs/server-first-rows";
import { parseJobSlug } from "../../src/lib/jobs/job-slug";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LIGHTHOUSE =
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";

function landing(overrides: Partial<FrontDoorRequest> = {}, search = "", headers: Record<string, string> = {}): FrontDoorRequest {
    return {
        method: "GET",
        pathname: "/jobs",
        searchParams: new URLSearchParams(search),
        headers: new Headers({ "user-agent": DESKTOP_CHROME, "sec-fetch-dest": "document", ...headers }),
        signedIn: false,
        ...overrides,
    };
}

test("a signed-out visitor opening bare /jobs gets the front door from the server, at every width", () => {
    assert.equal(shouldServeFrontDoor(landing()), true, "desktop");
    assert.equal(shouldServeFrontDoor(landing({}, "", { "user-agent": ANDROID_CHROME })), true, "phone");
    assert.equal(shouldServeFrontDoor(landing({}, "", { "user-agent": LIGHTHOUSE })), true, "speed scanners and crawlers see the page people see");
    // Older browsers don't send Sec-Fetch-Dest; a plain document request still counts.
    assert.equal(shouldServeFrontDoor({ ...landing(), headers: new Headers({ "user-agent": DESKTOP_CHROME }) }), true);
});

test("a link that only says where the visit came from still lands on the front door", () => {
    assert.equal(shouldServeFrontDoor(landing({}, "?utm_source=betalist&utm_medium=launch")), true);
    assert.equal(shouldServeFrontDoor(landing({}, "?ref=betalist")), true);
    assert.equal(shouldServeFrontDoor(landing({}, "?gclid=abc&fbclid=def")), true);
});

test("anything that asks for more than the front door keeps the prerendered /jobs", () => {
    assert.equal(shouldServeFrontDoor(landing({ signedIn: true })), false, "signed in: /jobs can be For you");
    assert.equal(shouldServeFrontDoor(landing({}, "?q=nurse")), false, "a search");
    assert.equal(shouldServeFrontDoor(landing({}, "?utm_source=x&q=nurse")), false, "a search with a campaign tag");
    assert.equal(shouldServeFrontDoor(landing({}, "?job=abc")), false, "a shared job");
    assert.equal(shouldServeFrontDoor(landing({}, "?view=for-you")), false, "a view");
    assert.equal(shouldServeFrontDoor(landing({}, "?country=CA")), false, "a filter");
    assert.equal(shouldServeFrontDoor(landing({}, "?resume=gate")), false, "the post-sign-in résumé step");
    assert.equal(shouldServeFrontDoor(landing({ method: "POST" })), false, "server actions post to /jobs");
    assert.equal(shouldServeFrontDoor(landing({ method: "HEAD" })), false);
    assert.equal(shouldServeFrontDoor(landing({ pathname: "/" })), false);
    assert.equal(shouldServeFrontDoor(landing({ pathname: "/jobs/some-role-1" })), false);
});

test("client navigations, prefetches and fetches keep the prerendered page", () => {
    assert.equal(shouldServeFrontDoor(landing({}, "", { rsc: "1" })), false, "client navigation");
    assert.equal(shouldServeFrontDoor(landing({}, "", { rsc: "1", "next-router-prefetch": "1" })), false, "prefetch");
    assert.equal(shouldServeFrontDoor(landing({}, "", { "next-action": "abc" })), false, "server action");
    assert.equal(shouldServeFrontDoor(landing({}, "", { "sec-fetch-dest": "empty" })), false, "fetch()");
});

test("the front door and the phone first rows never claim the same request", () => {
    for (const search of ["", "?q=nurse", "?utm_source=x", "?q=nurse&utm_source=x"]) {
        const req = landing({}, search, { "user-agent": ANDROID_CHROME, "accept-language": "en-US" });
        const both = shouldServeFrontDoor(req) && shouldServeFirstRows({ ...req, isBot: false });
        assert.equal(both, false, search || "bare /jobs");
    }
});

test("the rewrite target can never be a job's page", () => {
    assert.equal(FRONT_DOOR_PATH.startsWith("/jobs/"), true);
    assert.notEqual(FRONT_DOOR_PATH, FIRST_ROWS_PATH);
    assert.equal(parseJobSlug(FRONT_DOOR_PATH.slice("/jobs/".length)), null);
});

test("the middleware rewrites AuthKit's own response and sends direct visits back to /jobs", () => {
    const src = read("src/middleware.ts");
    const authkitResponse = src.indexOf("const response = handleAuthkitHeaders(request, headers);");
    const decision = src.indexOf("shouldServeFrontDoor({");
    assert.ok(decision > authkitResponse, "decided once the session is known, on AuthKit's response");
    assert.match(src, /pathname: isFrontDoorPath \? "\/jobs" : pathname,/);
    assert.match(src, /if \(frontDoor\) return asRewrite\(response, request, FRONT_DOOR_PATH\);/);
    assert.match(
        src,
        /return frontDoor \? response : handleAuthkitHeaders\(request, headers, \{ redirect: jobsUrl\(request\), redirectStatus: 308 \}\);/,
    );
});

test("the page renders the list on the server, signed out, inline in the HTML", () => {
    const page = read("src/app/jobs/front-door/page.tsx");
    // Per request: the list reads the address while it renders, and a
    // prerender would leave all of it to the browser.
    assert.match(page, /await connection\(\);/);
    assert.match(page, /<JobsRouteGate signedOut \/>/);

    const gate = read("src/app/jobs/JobsRouteGate.tsx");
    assert.match(gate, /<JobsContent initialSearch=\{initialSearch\} signedOutOnServer=\{signedOut\} \/>/);
    // No boundary on the server-rendered pages: React streams a large
    // finished boundary apart and shows it on the next animation frame.
    assert.match(gate, /if \(renderedOnServer\) return content;/);

    const content = read("src/app/jobs/JobsContent.tsx");
    assert.match(content, /const \[authReady, setAuthReady\] = useState\(signedOutOnServer\);/);
});
