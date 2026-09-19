import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findServerImports } from "@/lib/local-ai/find-server-imports";

// Founder rule: résumé interpretation never happens on our servers. Scanned
// class-wide across every directory that can touch résumé bytes or their
// parse — not just lib/local-ai — so a new file in any of them is covered
// by construction, not by remembering to add it to a list.
const SCAN_ROOTS = ["src/lib/local-ai", "src/components/resume-builder", "src/lib/resume"].map((rel) =>
    path.join(process.cwd(), rel),
);

// A file opts out of the ban by carrying this marker in its own source —
// e.g. a boolean existence check that happens to sit in a scanned directory
// but never touches résumé bytes/content. The exemption is a property of
// the file (grep-able, reviewed in that file's own diff), not a filename
// enumerated here, so it stays structural: any file, present or future, can
// carry it, and none are silently special-cased by name.
const EXEMPT_MARKER = "PARSE_GATE_EXEMPT:";

function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walkTsFiles(full));
        else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

/**
 * Resolve an import specifier from `fromFile` to an absolute file path.
 * Handles the `@/*` -> `src/*` tsconfig alias and relative specifiers;
 * returns null for bare package specifiers (node_modules) — those are
 * out of scope by construction, not by an allow-list.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith("@/")) {
        base = path.join(process.cwd(), "src", specifier.slice(2));
    } else if (specifier.startsWith(".")) {
        base = path.resolve(path.dirname(fromFile), specifier);
    } else {
        return null; // node_modules package — skipped
    }
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function hasUseServerDirective(file: string): boolean {
    const firstLine = readFileSync(file, "utf8").split("\n").find((l) => l.trim().length > 0)?.trim();
    return firstLine === '"use server";' || firstLine === "'use server';" || firstLine === '"use server"' || firstLine === "'use server'";
}

/**
 * The real-world decision: an import reaches server-only code if its
 * specifier points into an `actions/` directory (that's where every
 * server-action module lives, by convention) OR the file it resolves to
 * opens with the "use server" directive. Either is disqualifying for
 * résumé-parse code, which must never import anything that can run on
 * the server.
 */
function resolveDirective(fromFile: string) {
    return (specifier: string): boolean => {
        if (specifier.split("/").includes("actions")) return true;
        const resolved = resolveSpecifier(fromFile, specifier);
        return resolved !== null && hasUseServerDirective(resolved);
    };
}

describe("findServerImports (pure)", () => {
    it("flags a specifier that points into an actions/ directory", () => {
        const hits = findServerImports(
            `import { parseResumeWithAI } from "@/actions/resume";\n`,
            (specifier) => specifier.split("/").includes("actions"),
        );
        assert.equal(hits.length, 1);
        assert.equal(hits[0].specifier, "@/actions/resume");
    });

    it("flags a relative import of a module whose first statement is \"use server\"", () => {
        const hits = findServerImports(
            `import { doThing } from "../server/thing";\n`,
            (specifier) => specifier === "../server/thing",
        );
        assert.equal(hits.length, 1);
        assert.equal(hits[0].specifier, "../server/thing");
    });

    it("flags nothing for a clean file", () => {
        const hits = findServerImports(
            `import { useState } from "react";\nimport { parseResumeLocally } from "@/lib/local-ai/parse-resume";\n`,
            () => false,
        );
        assert.equal(hits.length, 0);
    });
});

describe("local-ai module isolation", () => {
    it("does not import any server-action module or file carrying \"use server\" (structural scan)", () => {
        const files = SCAN_ROOTS.flatMap(walkTsFiles);
        assert.ok(files.length > 0, "expected source files under the scanned roots");
        for (const file of files) {
            const source = readFileSync(file, "utf8");
            if (source.includes(EXEMPT_MARKER)) continue;
            const hits = findServerImports(source, resolveDirective(file));
            assert.deepEqual(
                hits,
                [],
                `${path.relative(process.cwd(), file)} imports server-only module(s): ${hits.map((h) => `${h.specifier} (line ${h.line})`).join(", ")}`,
            );
        }
    });
});
