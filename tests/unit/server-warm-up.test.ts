import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPhoneRequest, shouldServeFirstRows } from "../../src/lib/jobs/server-first-rows";
import { WARM_UP_HEADERS, WARM_UP_PATH, warmUp, warmUpBaseUrl } from "../../src/lib/server-warm-up";

const noSleep = async () => {};
const ROWS_PAGE = '<ul><li data-testid="job-row">a</li></ul>';
const EMPTY_PAGE = "<main>no rows yet</main>";

function fakeFetch(answers: Array<"refused" | { status: number; body: string }>) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
        calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
        const next = answers.shift() ?? "refused";
        if (next === "refused") throw new TypeError("fetch failed: ECONNREFUSED");
        return new Response(next.body, { status: next.status });
    }) as unknown as typeof fetch;
    return { impl, calls };
}

test("the warm-up request is one the middleware serves first rows to", () => {
    const url = new URL(`http://127.0.0.1:3000${WARM_UP_PATH}`);
    const headers = new Headers(WARM_UP_HEADERS);
    assert.equal(isPhoneRequest(headers), true);
    assert.equal(
        shouldServeFirstRows({
            method: "GET",
            pathname: url.pathname,
            searchParams: url.searchParams,
            headers,
            signedIn: false,
            isBot: false,
        }),
        true,
    );
});

test("the base URL is loopback for a wildcard bind and the host otherwise", () => {
    assert.equal(warmUpBaseUrl("3000"), "http://127.0.0.1:3000");
    assert.equal(warmUpBaseUrl("3000", "0.0.0.0"), "http://127.0.0.1:3000");
    assert.equal(warmUpBaseUrl("3000", "::"), "http://127.0.0.1:3000");
    assert.equal(warmUpBaseUrl("8080", "localhost"), "http://localhost:8080");
    assert.equal(warmUpBaseUrl("8080", "::1"), "http://[::1]:8080");
});

test("waits for the server to listen, then stops at the first page with rows", async () => {
    const { impl, calls } = fakeFetch(["refused", "refused", { status: 200, body: ROWS_PAGE }]);
    const result = await warmUp({ port: "3000", hostname: "0.0.0.0", fetchImpl: impl, sleep: noSleep });
    assert.deepEqual(result, { rows: true, pages: 1 });
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, "http://127.0.0.1:3000/jobs?q=engineer");
    assert.equal(calls[2].headers["user-agent"], WARM_UP_HEADERS["user-agent"]);
});

test("a page sent without rows (search over budget) is fetched again", async () => {
    const { impl, calls } = fakeFetch([
        { status: 200, body: EMPTY_PAGE },
        { status: 200, body: EMPTY_PAGE },
        { status: 200, body: ROWS_PAGE },
    ]);
    const result = await warmUp({ port: "3000", fetchImpl: impl, sleep: noSleep });
    assert.deepEqual(result, { rows: true, pages: 3 });
    assert.equal(calls.length, 3);
});

test("gives up after the page limit without throwing", async () => {
    const { impl, calls } = fakeFetch([
        { status: 500, body: ROWS_PAGE },
        { status: 200, body: EMPTY_PAGE },
        { status: 200, body: EMPTY_PAGE },
        { status: 200, body: EMPTY_PAGE },
        { status: 200, body: ROWS_PAGE },
    ]);
    const result = await warmUp({ port: "3000", fetchImpl: impl, sleep: noSleep, pageAttempts: 4 });
    assert.deepEqual(result, { rows: false, pages: 4 });
    assert.equal(calls.length, 4);
});

test("gives up when the server never listens", async () => {
    const { impl, calls } = fakeFetch([]);
    const result = await warmUp({ port: "3000", fetchImpl: impl, sleep: noSleep, connectAttempts: 5 });
    assert.deepEqual(result, { rows: false, pages: 0 });
    assert.equal(calls.length, 5);
});

test("the row marker is the one the list renders", () => {
    const row = readFileSync(path.join(__dirname, "../../src/components/jobs/JobCard.tsx"), "utf8");
    assert.match(row, /data-testid="job-row"/);
});
