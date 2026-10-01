import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `getCurrentUser()` is null for every real session (only the dev-only e2e
 * hook answers it), so a click that branched on it sent signed-in people down
 * the guest path in production: "Could not find this pursuit." on every
 * tracker status change, an email step on Follow, saved searches kept in the
 * browser (founder report 2026-10-01). It may seed a first paint (a
 * `useState` initializer, or an effect that hands it to `setUser` before
 * `onAuthChange` answers); a click asks `getSignedInUser()`.
 */

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

test("getCurrentUser() only seeds a first paint; no handler decides a write with it", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(new URL("../../src", import.meta.url).pathname)) {
        if (file.endsWith("lib/firebase/client-auth.ts")) continue;
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
            if (!line.includes("getCurrentUser()")) return;
            const trimmed = line.trim();
            if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
            if (/useState/.test(line)) return;
            if (/setUser\(/.test(lines.slice(i + 1, i + 4).join("\n"))) return;
            offenders.push(`${file.replace(/^.*\/src\//, "src/")}:${i + 1}: ${trimmed}`);
        });
    }
    assert.deepEqual(offenders, []);
});

test("getSignedInUser() reads the account the session check confirmed", () => {
    const src = readFileSync(new URL("../../src/lib/firebase/client-auth.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function getSignedInUser"));
    assert.match(body, /e2eMockUser\(\)/);
    assert.match(body, /isSignedOutMarkerSet\(\)/);
    assert.match(body, /return resolvedUser;/);
});
