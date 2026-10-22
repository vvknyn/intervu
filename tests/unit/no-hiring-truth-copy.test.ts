import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// "Hiring truth" is jargon (Wave 3 J3): "Posting check" is the plain name. MCP prose (src/lib/agent) is out of scope.
const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return sourceFiles(full);
        return /\.(tsx?|mdx?)$/.test(name) ? [full] : [];
    });
}

test("no UI string or comment in src/components or src/app says 'hiring truth'", () => {
    const hits = [...sourceFiles(join(ROOT, "src", "components")), ...sourceFiles(join(ROOT, "src", "app"))].filter((f) =>
        /hiring[\s-]truth/i.test(readFileSync(f, "utf8")),
    );
    assert.deepEqual(hits.map((f) => f.slice(ROOT.length + 1)), []);
});
