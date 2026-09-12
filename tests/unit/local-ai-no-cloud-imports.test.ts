import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const LOCAL_AI_ROOT = path.join(process.cwd(), "src/lib/local-ai");
const FORBIDDEN = ["generateGenericJSON", "actions/generate-context", "openrouter"];

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
    it("does not import cloud LLM paths (static source scan)", () => {
        const files = walkTsFiles(LOCAL_AI_ROOT);
        assert.ok(files.length > 0, "expected local-ai source files");
        for (const file of files) {
            const src = readFileSync(file, "utf8");
            for (const needle of FORBIDDEN) {
                assert.ok(
                    !src.includes(needle),
                    `${path.relative(process.cwd(), file)} must not reference ${needle}`,
                );
            }
        }
    });
});
