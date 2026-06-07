// Domain patterns known to host unsafe/explicit content
const BLOCKED_DOMAIN_PATTERNS: RegExp[] = [
    // Explicit TLDs
    /\.xxx$/i,
    /\.porn$/i,
    /\.sex$/i,
    /\.adult$/i,
    /\.sexy$/i,
    /\.xxx\./i,
    // Major explicit sites
    /pornhub\./i,
    /xvideos\./i,
    /xnxx\./i,
    /xhamster\./i,
    /redtube\./i,
    /youporn\./i,
    /tube8\./i,
    /spankbang\./i,
    /xtube\./i,
    /porntrex\./i,
    /eporner\./i,
    /hqporner\./i,
    /beeg\./i,
    /txxx\./i,
    /fapvid\./i,
    /thumbzilla\./i,
    /pornpics\./i,
    /rule34\./i,
    /gelbooru\./i,
    /e-hentai\./i,
    /nhentai\./i,
    /hanime\./i,
    /hentaihaven\./i,
    /cam4\./i,
    /chaturbate\./i,
    /livejasmin\./i,
    /stripchat\./i,
    /bongacams\./i,
    /myfreecams\./i,
    /onlyfans\./i,
    /fansly\./i,
    /manyvids\./i,
    /clips4sale\./i,
];

// Word-boundary keyword patterns for detecting explicit content
const UNSAFE_CONTENT_KEYWORDS: RegExp[] = [
    /\bpornograph(y|ic)\b/i,
    /\bexplicit\s+sexual\b/i,
    /\bhardcore\s+sex\b/i,
    /\bxxx\s+video/i,
    /\badult\s+content\b/i,
    /\bnude\s+photos?\b/i,
    /\bnaked\s+girls?\b/i,
    /\bnaked\s+women\b/i,
    /\bfull\s+nude\b/i,
    /\berotic\s+video\b/i,
    /\bhentai\b/i,
    /\bescort\s+service/i,
    /\bsex\s+worker/i,
    /\bstrip\s*club/i,
    /\badult\s+entertainment\b/i,
    /\blive\s*cam\s*girl/i,
    /\bwebcam\s+model/i,
    /\bnsfw\s+content\b/i,
    /\bxxx\s+pics?\b/i,
    /\bfetish\s+porn\b/i,
    /\bmilf\b/i,
    /\bhooker\b/i,
    /\bsexcam\b/i,
    /\bcamgirl\b/i,
    /\bonly\s*fans\s+leak/i,
];

export interface SafetyResult {
    safe: boolean;
    reason?: string;
}

// ---------------------------------------------------------------------------
// SSRF protection
//
// Server actions that fetch a USER-SUPPLIED URL must call assertSafeFetchUrl()
// first. It rejects non-http(s) schemes and any host that points at a private,
// loopback, link-local, or cloud-metadata address — including via a DNS name
// that resolves to one of those ranges (DNS-rebinding / metadata-SSRF defense).
// ---------------------------------------------------------------------------

/** Error thrown when a URL fails the SSRF safety checks. */
export class UnsafeUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UnsafeUrlError";
    }
}

/** True if an IPv4 string is in a private / loopback / link-local / metadata range. */
function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return true; // unparseable → treat as unsafe
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
}

/** True if an IPv6 string is loopback / link-local / unique-local / mapped-private. */
function isPrivateIPv6(ip: string): boolean {
    let addr = ip.toLowerCase();
    // Strip zone id (e.g. fe80::1%eth0) and surrounding brackets.
    addr = addr.replace(/^\[|\]$/g, "").split("%")[0];

    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — re-check the embedded v4.
    const mappedDotted = addr.match(/(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);
    // IPv4-mapped in hex form (the URL parser normalizes ::ffff:127.0.0.1 to
    // ::ffff:7f00:1) — decode the two trailing hextets back to dotted v4.
    const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16);
        const lo = parseInt(mappedHex[2], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIPv4(v4);
    }

    const head = addr.split(":")[0] || "";
    if (head === "fe80" || (head >= "fe80" && head <= "febf")) return true; // fe80::/10 link-local
    // fc00::/7 unique-local (fc00–fdff)
    if (head.length >= 2) {
        const prefix = parseInt(head.slice(0, 2), 16);
        if (!Number.isNaN(prefix) && prefix >= 0xfc && prefix <= 0xfd) return true;
    }
    return false;
}

/** True if a literal IP string (v4 or v6) is in a blocked range. */
export function isBlockedIp(ip: string): boolean {
    return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * Assert that a user-supplied URL is safe to fetch server-side. Throws
 * `UnsafeUrlError` when the scheme is not http(s), or when the host (literal IP
 * OR DNS-resolved IP) is private/loopback/link-local/metadata. Also runs the
 * existing explicit-content domain blocklist.
 *
 * Returns the parsed URL on success so callers can reuse it.
 */
export async function assertSafeFetchUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new UnsafeUrlError("Invalid URL");
    }

    // Only http(s) — blocks file:, data:, gopher:, ftp:, etc.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new UnsafeUrlError("Only http(s) URLs are allowed");
    }

    const contentCheck = checkUrlSafety(rawUrl);
    if (!contentCheck.safe) {
        throw new UnsafeUrlError(contentCheck.reason || "This URL has been blocked for safety reasons");
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname) {
        throw new UnsafeUrlError("URL has no host");
    }

    // "localhost" and friends never resolve to anything public.
    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
        throw new UnsafeUrlError("Refusing to fetch a loopback address");
    }

    // If the host is already a literal IP, check it directly.
    const isLiteralIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
    if (isLiteralIp) {
        if (isBlockedIp(hostname)) {
            throw new UnsafeUrlError("Refusing to fetch a private or loopback address");
        }
        return parsed;
    }

    // Otherwise resolve DNS and re-check every returned address (DNS-rebinding /
    // metadata-SSRF defense). dns.promises is Node-only; these callers are all
    // "use server" actions.
    const dns = await import("dns");
    let addresses: { address: string }[];
    try {
        addresses = await dns.promises.lookup(hostname, { all: true });
    } catch {
        throw new UnsafeUrlError("Could not resolve host");
    }
    if (!addresses.length) {
        throw new UnsafeUrlError("Could not resolve host");
    }
    for (const { address } of addresses) {
        if (isBlockedIp(address)) {
            throw new UnsafeUrlError("Refusing to fetch a private or loopback address");
        }
    }

    return parsed;
}

export function checkUrlSafety(url: string): SafetyResult {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        for (const pattern of BLOCKED_DOMAIN_PATTERNS) {
            if (pattern.test(hostname)) {
                return {
                    safe: false,
                    reason: "This URL has been blocked for safety reasons",
                };
            }
        }

        return { safe: true };
    } catch {
        return { safe: false, reason: "Invalid URL" };
    }
}

export function checkContentSafety(content: string): SafetyResult {
    const lower = content.toLowerCase();
    let matchCount = 0;

    for (const pattern of UNSAFE_CONTENT_KEYWORDS) {
        if (pattern.test(lower)) {
            matchCount++;
        }
        if (matchCount >= 3) {
            return {
                safe: false,
                reason: "Content blocked: unsafe material detected",
            };
        }
    }

    return { safe: true };
}

export function checkContentSafetyStrict(content: string): SafetyResult {
    const lower = content.toLowerCase();

    for (const pattern of UNSAFE_CONTENT_KEYWORDS) {
        if (pattern.test(lower)) {
            return {
                safe: false,
                reason: "Content blocked: unsafe material detected",
            };
        }
    }

    return { safe: true };
}
