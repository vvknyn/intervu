/**
 * Pure hyperlink detection for résumé text (PDF link annotations, HTML export,
 * and diagnostics). Zero runtime dependencies so callers never pull jsPDF into
 * browser or server bundles that only need URL detection.
 */

export interface ResumeTextLinkMatch {
    /** Exact substring as written in the résumé text (e.g. "velai.app", "linkedin.com/in/viveknar"). */
    text: string;
    /** Normalized target URI (e.g. "https://velai.app", "mailto:viveknyan@gmail.com"). */
    url: string;
    /** Start UTF-16 code-unit offset inside the input string. */
    index: number;
}

/**
 * Real web TLDs used for bare domains on résumés ("velai.app", "intervu.cc", "jane.dev").
 * Intentionally excludes programming-language / framework suffixes (.js, .ts, .py, .net, .sh, .rs, .go, .css)
 * so "Next.js", "Node.js", "Vue.js", "ASP.NET" never false-positive as domains.
 */
const WEB_TLDS =
    "app|io|ai|dev|cc|xyz|com|org|co|ca|uk|us|eu|de|fr|in|au|me|tech|design|site|online|cloud|gg|so|to|fm|tv|vc|ly|link|page|work|studio|systems|solutions|digital|agency|health|bio|edu|gov";

/** Tech libraries whose names look like bare `.io` domains in skills lists. */
const NON_LINK_BARE_DOMAINS = new Set([
    "socket.io",
    "draw.io",
    "cypress.io",
    "prisma.io",
    "fly.io",
    " Temporal.io".trim().toLowerCase(),
    "sentry.io",
    "redis.io",
    "kubernetes.io",
    "istio.io",
    "helm.sh",
]);

const RESUME_LINK_TOKEN_RE = new RegExp(
    [
        // 1. Email address
        String.raw`(?<email>[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24})`,
        // 2. Explicit http(s):// URL
        String.raw`(?<url>https?:\/\/[^\s|·•,;<>)"'\]]+)`,
        // 3.Bare domain (with optional /path), not preceded by @, /, or word chars
        String.raw`(?<![A-Za-z0-9@/_.-])(?<domain>(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:${WEB_TLDS})(?:\/[^\s|·•,;<>)"'\]]*)?)(?![A-Za-z0-9_-])`,
    ].join("|"),
    "gi",
);

function trimTrailingPunctuation(raw: string): string {
    return raw.replace(/[.,;:!?)'"\]]+$/, "");
}

/**
 * Finds all linkable tokens (emails, explicit URLs, LinkedIn/GitHub paths, and
 * bare web domains like `velai.app`) in `text` with their character offsets.
 */
export function matchResumeLinks(text: string): ResumeTextLinkMatch[] {
    if (!text) return [];
    const out: ResumeTextLinkMatch[] = [];
    for (const match of text.matchAll(RESUME_LINK_TOKEN_RE)) {
        const raw = match[0];
        const index = match.index ?? 0;
        const cleaned = trimTrailingPunctuation(raw);
        if (!cleaned) continue;

        const groups = match.groups ?? {};
        if (groups.email) {
            const email = trimTrailingPunctuation(groups.email);
            out.push({ text: email, url: `mailto:${email}`, index });
            continue;
        }
        if (groups.url) {
            const url = trimTrailingPunctuation(groups.url);
            out.push({ text: url, url, index });
            continue;
        }
        if (groups.domain) {
            const domain = trimTrailingPunctuation(groups.domain);
            const lower = domain.toLowerCase();
            if (NON_LINK_BARE_DOMAINS.has(lower)) continue;
            // Skip version-like tokens or abbreviations
            if (/^\d+\.\d+$/.test(domain)) continue;
            out.push({
                text: domain,
                url: /^https?:\/\//i.test(domain) ? domain : `https://${domain}`,
                index,
            });
        }
    }
    return out;
}
