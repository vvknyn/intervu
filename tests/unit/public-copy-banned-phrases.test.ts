import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../..");

/** Product sentences that are false for this app. Public copy must not contain them. */
const BANNED_PUBLIC_PHRASES: { pattern: RegExp; label: string }[] = [
    { pattern: /AI is local/i, label: "AI is local" },
    { pattern: /matching is local/i, label: "matching is local" },
    { pattern: /100%\s*private/i, label: "100% private" },
    { pattern: /never stored/i, label: "never stored" },
    { pattern: /never on our servers/i, label: "never on our servers" },
];

function listSrcFiles(dir: string): string[] {
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

/** Comments are not product copy. String literals and JSX text remain. */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function bannedPhraseIn(src: string): string | null {
    const scanned = stripComments(src);
    for (const { pattern, label } of BANNED_PUBLIC_PHRASES) {
        if (pattern.test(scanned)) return label;
    }
    return null;
}

describe("public copy — banned privacy phrases", () => {
    it("CONTROL: a user-visible string hits, a comment does not", () => {
        assert.equal(bannedPhraseIn('const x = "AI is local";'), "AI is local");
        assert.equal(bannedPhraseIn('const x = "matching is local";'), "matching is local");
        assert.equal(bannedPhraseIn('const x = "100% private";'), "100% private");
        assert.equal(bannedPhraseIn('const x = "never stored";'), "never stored");
        assert.equal(bannedPhraseIn('const x = "never on our servers";'), "never on our servers");
        assert.equal(bannedPhraseIn("// AI is local\n/* never stored */\nconst x = \"ok\";"), null);
    });

    it("src public copy does not contain the banned phrases", () => {
        const hits: string[] = [];
        for (const file of listSrcFiles(join(ROOT, "src"))) {
            const hit = bannedPhraseIn(readFileSync(file, "utf8"));
            if (hit) hits.push(`${file.slice(ROOT.length + 1)}: ${hit}`);
        }
        assert.deepEqual(hits, []);
    });
});
