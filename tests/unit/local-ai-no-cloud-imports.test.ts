import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Founder rule: résumé interpretation never happens on our servers. Scanned
// class-wide across every directory that can touch résumé bytes or their
// parse — not just lib/local-ai — so a new file in any of them is covered
// by construction, not by remembering to add it to a list.
const SCAN_ROOTS = ["src/lib/local-ai", "src/components/resume-builder", "src/lib/resume"].map((rel) =>
    path.join(process.cwd(), rel),
);

const FORBIDDEN = [
    "generateGenericJSON",
    "actions/generate-context",
    "openrouter",
    "parseResumeWithAI",
    "extractPDFText",
    "extractDocxText",
];

function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walkTsFiles(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

describe("local-ai module isolation", () => {
    it("does not import cloud LLM paths or server-side résumé extraction (static source scan)", () => {
        const files = SCAN_ROOTS.flatMap(walkTsFiles);
        assert.ok(files.length > 0, "expected source files under the scanned roots");
        for (const file of files) {
            const lines = readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                for (const needle of FORBIDDEN) {
                    // `extractPDFText`/`extractDocxText` are substrings of the
                    // real, allowed in-browser functions — only flag the bare
                    // server-action name, not ...InBrowser.
                    if (line.includes(needle + "InBrowser")) continue;
                    assert.ok(
                        !line.includes(needle),
                        `${path.relative(process.cwd(), file)}:${index + 1} must not reference ${needle}`,
                    );
                }
            });
        }
    });
});
