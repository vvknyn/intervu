import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards two defects the resume editor actually shipped with, both of which
 * every other gate in the repo waved through.
 *
 * 1. `originalBaseline` was advanced on every save and read by nothing, so the
 *    diff view kept comparing against the pre-save resume and flagged saved
 *    content as changed. eslint cannot see this: calling `setOriginalBaseline`
 *    counts as a use, so write-only state lints clean forever.
 * 2. `downloadBlob` existed three times — twice copy-pasted verbatim and once
 *    inlined — so the same helper could drift in three places.
 */

const SRC = join(process.cwd(), "src");
const EDITOR = join(SRC, "components/resume-builder/ResumeEditor.tsx");

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
}

describe("resume editor state is read, not just written", () => {
    const src = readFileSync(EDITOR, "utf8");
    // Setters are conventionally `setX` with a capital X, so a case-sensitive
    // word-boundary match on the bare name never counts the setter as a read.
    // (That exact case difference is what hid the bug from a manual grep.)
    const declared = [...src.matchAll(/const \[(\w+), (set\w+)\] = useState/g)].map((m) => ({
        name: m[1],
        setter: m[2],
        line: m[0],
    }));

    it("finds the component's useState declarations", () => {
        assert.ok(declared.length >= 8, `parsed only ${declared.length} useState calls — the regex has drifted`);
    });

    it("every piece of state is read somewhere beyond its own declaration", () => {
        for (const { name, setter, line } of declared) {
            assert.ok(!name.startsWith("set"), `${name} looks like a setter, not state`);
            const reads = [...src.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length;
            assert.ok(
                reads >= 2,
                `\`${name}\` is written via ${setter} but never read. Either wire it to ` +
                    `something or delete it — write-only state lints clean and silently does nothing. (${line})`,
            );
        }
    });

    it("the diff baseline falls back to the last saved resume", () => {
        assert.match(
            src,
            /originalData=\{showDiffs \? \(compareBaseline\?\.data \?\? originalBaseline\) : null\}/,
            "the preview must fall back to originalBaseline so diffs re-baseline after a save",
        );
    });

    it("every download handler has a control that calls it", () => {
        const handlers = [...src.matchAll(/const (handleDownload\w+) =/g)].map((m) => m[1]);
        assert.ok(handlers.length >= 3, `expected the pdf/docx/json handlers, found ${handlers.length}`);
        for (const h of handlers) {
            assert.match(src, new RegExp(`onClick=\\{${h}\\}`), `${h} is defined but no control invokes it`);
        }
    });
});

describe("downloadBlob has one definition", () => {
    it("is defined exactly once across src/", () => {
        const defs = walk(SRC).filter((f) => /function downloadBlob\s*\(/.test(readFileSync(f, "utf8")));
        assert.deepEqual(
            defs.map((f) => f.slice(SRC.length + 1)),
            ["lib/export-utils.ts"],
            "downloadBlob must live in one place; consumers import it",
        );
    });

    it("consumers import it rather than re-declaring it", () => {
        for (const f of [EDITOR, join(SRC, "components/settings/YourResumeSection.tsx")]) {
            const s = readFileSync(f, "utf8");
            assert.ok(s.includes("downloadBlob"), `${f} no longer uses downloadBlob — update this guard`);
            assert.match(s, /import \{ downloadBlob \} from "@\/lib\/export-utils"/, `${f} must import downloadBlob`);
        }
    });
});
