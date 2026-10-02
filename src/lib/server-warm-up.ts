/**
 * The server opens one phone search link itself as soon as it listens, so
 * the first visitors after a deploy or a restart don't pay its cold start.
 *
 * A fresh server's first searches build the place index, open the country
 * database and fill the search caches, and the first search link a phone
 * opens renders its rows on the server only when its search answers within
 * `FIRST_ROWS_SEARCH_BUDGET_MS` (server-first-rows.ts). On release 17
 * (2026-10-02) the first two phone search links after the container came up
 * missed that budget and were sent without rows (5.0 s and 1.3 s); from the
 * third on they had 18 rows in about 0.8 s.
 *
 * The warm-up goes through the front door (middleware, the first-rows page,
 * the search action) rather than calling the search code directly: this
 * hook is bundled apart from the pages, so its copies of the search
 * modules' caches are not the ones visitors' requests use. It repeats until
 * a page comes back with rows, a few times at most, and never throws.
 */

/** A common search, so the caches it fills serve real visitors too. */
export const WARM_UP_PATH = "/jobs?q=engineer";

/** What a signed-out phone opening a search link sends (server-first-rows.ts). */
export const WARM_UP_HEADERS: Readonly<Record<string, string>> = {
    "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    accept: "text/html",
};

const ROW_MARKER = 'data-testid="job-row"';

export interface WarmUpOptions {
    /** The port this server listens on (`PORT`). */
    port: string;
    /** The address it binds (`HOSTNAME`); a wildcard means loopback. */
    hostname?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    /** Tries while the server is not listening yet. */
    connectAttempts?: number;
    /** Pages fetched at most, until one has rows. */
    pageAttempts?: number;
}

export interface WarmUpResult {
    /** Whether a page came back with server-rendered rows. */
    rows: boolean;
    /** Pages fetched. */
    pages: number;
}

// Unref'd: a warm-up still waiting never keeps a process alive on its own.
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

export function warmUpBaseUrl(port: string, hostname?: string): string {
    const host = !hostname || hostname === "0.0.0.0" || hostname === "::" ? "127.0.0.1" : hostname;
    return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

export async function warmUp({
    port,
    hostname,
    fetchImpl = fetch,
    sleep = defaultSleep,
    connectAttempts = 40,
    pageAttempts = 4,
}: WarmUpOptions): Promise<WarmUpResult> {
    const url = `${warmUpBaseUrl(port, hostname)}${WARM_UP_PATH}`;
    let pages = 0;
    let refused = 0;
    while (pages < pageAttempts && refused < connectAttempts) {
        // register() has to return before the server listens, so the first
        // try always waits.
        await sleep(pages === 0 ? 500 : 1_000);
        let html: string;
        try {
            const res = await fetchImpl(url, { headers: WARM_UP_HEADERS, signal: AbortSignal.timeout(20_000) });
            // Read the whole page, so its render finishes instead of being cut off.
            html = await res.text();
            pages += 1;
            if (!res.ok) continue;
        } catch {
            refused += 1;
            continue;
        }
        if (html.includes(ROW_MARKER)) return { rows: true, pages };
    }
    return { rows: false, pages };
}
