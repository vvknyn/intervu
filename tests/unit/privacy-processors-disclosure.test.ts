import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

/**
 * Processors that may handle user-related data. Each `needles` entry must
 * match somewhere under `src/` when that integration is live; the matching
 * `privacyLabel` must appear in the /privacy article body (not comments).
 */
const PROCESSOR_DEFS = [
    { privacyLabel: "WorkOS", needles: [/@workos-inc/] },
    { privacyLabel: "PostHog", needles: [/posthog-js/, /POSTHOG_OPTIONS/] },
    { privacyLabel: "Resend", needles: [/from ["']resend["']/] },
    { privacyLabel: "OpenRouter", needles: [/OPENROUTER_API_KEY/, /provider:\s*["']openrouter["']/] },
    { privacyLabel: "Groq", needles: [/GROQ_API_KEY/, /from ["']groq-sdk["']/] },
    { privacyLabel: "Google Cloud Firestore", needles: [/firebase-admin\/firestore/, /getAdminDb\s*\(/] },
    { privacyLabel: "Cloudflare Turnstile", needles: [/verifyTurnstile\s*\(/, /challenges\.cloudflare\.com/] },
] as const;

function listSrcFiles(dir = join(ROOT, "src")): string[] {
    const out: string[] = [];
    for (const ent of readdirSync(dir)) {
        const p = join(dir, ent);
        if (statSync(p).isDirectory()) {
            out.push(...listSrcFiles(p));
        } else if (/\.(ts|tsx)$/.test(ent)) {
            out.push(p);
        }
    }
    return out;
}

function srcCorpus(): string {
    return listSrcFiles()
        .map((path) => readFileSync(path, "utf8"))
        .join("\n");
}

function processorLive(def: (typeof PROCESSOR_DEFS)[number], corpus: string): boolean {
    return def.needles.some((needle) => needle.test(corpus));
}

function privacyProse(): string {
    if (!process.env.NEXT_PUBLIC_SITE_URL) {
        process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    }
    const src = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
    const article = src.split("<article")[1]?.split("</article>")[0] ?? src;
    return article.replace(/\/\/[^\n]*/g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("privacy page processor disclosure matches code", () => {
    it("CONTROL: processorLive detects a needle in corpus and rejects when absent", () => {
        const def = PROCESSOR_DEFS[0];
        assert.equal(processorLive(def, "@workos-inc/authkit-nextjs"), true);
        assert.equal(processorLive(def, "no auth vendor here"), false);
    });

    it("every processor wired in src/ is named in the /privacy article body", () => {
        const corpus = srcCorpus();
        const live = PROCESSOR_DEFS.filter((def) => processorLive(def, corpus));
        assert.ok(
            live.length === PROCESSOR_DEFS.length,
            `expected all ${PROCESSOR_DEFS.length} processor defs to be live in src/; live: ${live.map((d) => d.privacyLabel).join(", ")}`,
        );

        const prose = privacyProse();
        const undisclosed = live.filter(({ privacyLabel }) => !prose.includes(privacyLabel)).map(
            ({ privacyLabel }) => privacyLabel,
        );
        assert.deepEqual(
            undisclosed,
            [],
            `/privacy article missing processors still imported/called in src/: ${undisclosed.join(", ")}`,
        );
    });
});
