import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../src/components/jobs/for-you");
const BANNED = /\b(jungle|rails|packet)\b/i;

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) out.push(...walk(path));
        else if (/\.(tsx|ts)$/.test(name)) out.push(path);
    }
    return out;
}

describe("for-you UI copy scan", () => {
    it("user-facing strings avoid banned jargon", () => {
        for (const file of walk(ROOT)) {
            const stripped = readFileSync(file, "utf8")
                .replace(/\/\/[^\n]*/g, "")
                .replace(/\/\*[\s\S]*?\*\//g, "");
            assert.doesNotMatch(stripped, BANNED, `${file} contains banned jargon`);
        }
    });
});
