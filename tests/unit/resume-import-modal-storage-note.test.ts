import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { RESUME_IMPORT_STORAGE_NOTE, resumeImportStorageNote } from "@/lib/privacy-modes";

const STORAGE_NOTE_BY_IDENTIFIER: Record<string, string> = {
    RESUME_IMPORT_STORAGE_NOTE,
};

/**
 * `storageNote` (ResumeImportModal.tsx) is a required prop precisely
 * because the modal can't know where its caller persists the parsed
 * résumé — only the caller does. This test enforces that invariant
 * class-wide: for every file under src/app that renders
 * <ResumeImportModal, the storageNote it passes must mention "account"
 * if and only if that same file imports `saveResumeData` (the server
 * action that persists to the signed-in user's account). Scanned
 * structurally (walk + filter), not by naming which file is which, so a
 * new call site is covered by construction.
 */
const APP_ROOT = path.join(process.cwd(), "src/app");

function walkTsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walkTsxFiles(full));
        else if (entry.endsWith(".tsx")) out.push(full);
    }
    return out;
}

/**
 * Every real JSX call site's storageNote literal in the file — `<ResumeImportModal`
 * followed by whitespace (a real opening tag with attributes) up to its
 * closing `/>`. Excludes prose mentions like `` `<ResumeImportModal>` `` in a
 * comment, which have no attributes to match against.
 */
function extractStorageNotes(source: string): string[] {
    const tags = source.match(/<ResumeImportModal\s[\s\S]*?\/>/g) ?? [];
    assert.ok(tags.length > 0, "<ResumeImportModal> JSX call site not found");
    return tags.map((tag) => {
        const literal = tag.match(/storageNote="([^"]*)"/);
        if (literal) return literal[1];
        const bound = tag.match(/storageNote=\{([A-Z_][A-Z0-9_]*)\}/);
        if (bound) {
            const resolved = STORAGE_NOTE_BY_IDENTIFIER[bound[1]!];
            assert.ok(resolved, `<ResumeImportModal> storageNote={${bound[1]}} is not registered in this test`);
            return resolved;
        }
        // State-derived: the signed-in branch is the one that persists to the account
        // (its guest branch is checked by the test below).
        if (/storageNote=\{resumeImportStorageNote\(/.test(tag)) return resumeImportStorageNote(true);
        assert.fail("<ResumeImportModal> call site has no storageNote attribute");
    });
}

/** Imports the account save: the action itself, or `saveResumeToAccount` (lib/jobs/save-resume-to-account.ts), its one wrapper. */
function importsSaveResumeData(source: string): boolean {
    return source
        .split("\n")
        .some((line) => line.trim().startsWith("import") && /\b(saveResumeData|saveResumeToAccount)\b/.test(line));
}

const callSites = walkTsxFiles(APP_ROOT).filter((file) => readFileSync(file, "utf8").includes("<ResumeImportModal"));

test("at least one real call site renders <ResumeImportModal (this test is not vacuous)", () => {
    assert.ok(callSites.length >= 2, `expected at least 2 real <ResumeImportModal call sites, found ${callSites.length}`);
});

for (const file of callSites) {
    const rel = path.relative(process.cwd(), file);
    test(`${rel}: storageNote mentions "account" iff the file imports saveResumeData`, () => {
        const source = readFileSync(file, "utf8");
        const persistsToAccount = importsSaveResumeData(source);
        for (const storageNote of extractStorageNotes(source)) {
            const claimsAccount = storageNote.toLowerCase().includes("account");
            assert.equal(
                claimsAccount,
                persistsToAccount,
                `${rel}: storageNote ${claimsAccount ? "claims" : "does not claim"} account persistence ("${storageNote}") but file ${persistsToAccount ? "imports" : "does not import"} saveResumeData`,
            );
        }
    });
}

test("the state-derived storage note claims the account only when signed in", () => {
    assert.match(resumeImportStorageNote(true).toLowerCase(), /account/);
    assert.doesNotMatch(resumeImportStorageNote(false).toLowerCase(), /account/);
});
