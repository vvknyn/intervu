"use server";

import * as cheerio from "cheerio";
import { checkContentSafety, assertSafeFetchUrl, UnsafeUrlError } from "@/lib/url-safety";
import { getServerUser } from "@/lib/auth/session";

const FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache"
};

/** Hard caps: total redirects followed and response body size. */
const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const FETCH_TIMEOUT_MS = 8000;

/**
 * SSRF-safe fetch for user-supplied URLs. Validates the URL (and every redirect
 * hop) against the private/loopback/metadata blocklist, follows redirects
 * manually with a cap, and aborts after ~8s. Throws UnsafeUrlError on a blocked
 * target.
 */
async function safeFetch(rawUrl: string): Promise<Response> {
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Re-validate every hop — defends against a public URL 30x-redirecting to
        // an internal/metadata address (and against DNS rebinding between hops).
        await assertSafeFetchUrl(current);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let response: Response;
        try {
            response = await fetch(current, {
                headers: FETCH_HEADERS,
                redirect: "manual", // we follow manually so each Location is re-checked
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        // Opaque-redirect (status 0) or a 3xx with Location → follow manually.
        const location = response.headers.get("location");
        const isRedirect = response.status === 0 || (response.status >= 300 && response.status < 400);
        if (isRedirect && location) {
            current = new URL(location, current).toString();
            continue;
        }
        return response;
    }
    throw new UnsafeUrlError("Too many redirects");
}

/** Read a response body with a hard byte cap to avoid memory-exhaustion DoS. */
async function readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return await response.text();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
            try { await reader.cancel(); } catch { /* ignore */ }
            break;
        }
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

export async function fetchUrlContent(url: string): Promise<{ data?: string; title?: string; error?: string }> {
    try {
        if (!url) return { error: "No URL provided" };

        // Require login — these fetch the open internet on the server's behalf.
        const user = await getServerUser();
        if (!user) return { error: "Please sign in to fetch content from a URL." };

        let response: Response;
        try {
            response = await safeFetch(url);
        } catch (e) {
            if (e instanceof UnsafeUrlError) return { error: e.message };
            throw e;
        }

        if (!response.ok) {
            return { error: "Could not access this link. Please paste the content directly." };
        }

        const html = await readCapped(response);
        const $ = cheerio.load(html);

        // Remove scripts, styles, and other non-content elements
        $('script, style, noscript, iframe, svg, header, footer, nav').remove();

        // Extract text from body
        const rawText = $('body').text().replace(/\s+/g, " ").trim();
        const title = $('title').text().trim() || url;

        // Content safety check
        const contentCheck = checkContentSafety(rawText);
        if (!contentCheck.safe) return { error: contentCheck.reason };

        // Simple check for valid content length
        if (rawText.length < 50) {
            return { error: "Could not retrieve sufficient content from this link. Please paste the text directly." };
        }

        // Limit length to avoid token limits (increased to 12k for better context)
        const truncated = rawText.substring(0, 12000);

        return { data: truncated, title };

    } catch (e: unknown) {
        console.error("Fetch URL Error:", e);
        return { error: "Unable to crawl this link. Please paste the content directly." };
    }
}

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|tar|gz|mp3|mp4|webm|avi|mov)$/i;

export async function discoverLinks(url: string): Promise<{ links: { url: string; title: string }[]; error?: string }> {
    try {
        // Require login — these fetch the open internet on the server's behalf.
        const user = await getServerUser();
        if (!user) return { links: [], error: "Please sign in to discover links." };

        let response: Response;
        let parsed: URL;
        try {
            parsed = await assertSafeFetchUrl(url);
            response = await safeFetch(url);
        } catch (e) {
            if (e instanceof UnsafeUrlError) return { links: [], error: e.message };
            throw e;
        }

        const baseDomain = parsed.hostname;

        if (!response.ok) return { links: [], error: "Could not access URL" };

        const html = await readCapped(response);
        const $ = cheerio.load(html);

        const seen = new Set<string>();
        seen.add(parsed.href.replace(/#.*$/, '')); // skip the original URL
        const results: { url: string; title: string }[] = [];

        $('a[href]').each((_, el) => {
            if (results.length >= 20) return false;

            const href = $(el).attr('href');
            if (!href) return;

            try {
                const resolved = new URL(href, url);
                // Same domain only
                if (resolved.hostname !== baseDomain) return;
                // Strip fragment
                resolved.hash = '';
                const canonical = resolved.href;

                if (seen.has(canonical)) return;
                // Skip assets
                if (ASSET_EXTENSIONS.test(resolved.pathname)) return;
                // Skip mailto/tel/javascript
                if (/^(mailto|tel|javascript):/i.test(href)) return;

                seen.add(canonical);
                const linkTitle = $(el).text().trim().substring(0, 100) || canonical;
                results.push({ url: canonical, title: linkTitle });
            } catch {
                // skip invalid URLs
            }
        });

        return { links: results };
    } catch (e: unknown) {
        console.error("Discover Links Error:", e);
        return { links: [], error: "Failed to discover links" };
    }
}
