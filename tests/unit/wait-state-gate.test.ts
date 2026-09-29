import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * ONE wait primitive (components/ui/wait-state.tsx) on ONE timing ladder
 * (lib/wait-state/ladder.ts). A raw spinner, skeleton or bare "Loading…"
 * anywhere else in src/ skips the ladder (flashes under 300 ms, never says what
 * it waits on). Exemption: an on-line `wait-state-ok: <reason>` marker.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findRawWaits } = require("../../scripts/design/wait-state.cjs") as {
    findRawWaits: (src: string) => Array<{ line: number; token: string }>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

const ROOT = path.resolve(__dirname, "../..");

test("no raw skeleton, spinner or bare Loading… in src outside the wait primitive", () => {
    const offenders: string[] = [];
    for (const file of walkTsxFiles(path.join(ROOT, "src"))) {
        for (const hit of findRawWaits(readFileSync(file, "utf8"))) {
            offenders.push(`${path.relative(ROOT, file)}:${hit.line} ${hit.token}`);
        }
    }
    assert.deepEqual(offenders, [], "use WaitState / WaitBar / InlineSpinner (or mark the line `wait-state-ok: <reason>`)");
});

test("detector: flags every shape of a hand-rolled wait", () => {
    const tokens = (src: string) => findRawWaits(src).map((h) => h.token);
    // The résumé-parse wait that surfaced this: a spinning glyph with its own copy.
    assert.deepEqual(tokens(`<Cpu size={24} className="mx-auto animate-spin text-brand" />`), ["animate-spin"]);
    // Other shapes of the same class.
    assert.deepEqual(tokens(`<div className="skeleton-bar h-8 w-8" />`), ["skeleton-bar"]);
    assert.deepEqual(tokens(`<Skeleton className="h-4 w-24" />`), ["<Skeleton"]);
    assert.deepEqual(tokens(`{busy ? <CircleNotch /> : <Trash />}`), ["CircleNotch"]);
    assert.deepEqual(tokens(`<p className="text-sm">Loading...</p>`), ["Loading..."]);
    assert.deepEqual(tokens(`const label = "Loading…";`), ["Loading…"]);
    assert.deepEqual(findRawWaits(`<div>\n<span className={cn(x && "animate-spin")} />`).map((h) => h.line), [2]);
});

test("detector: leaves the primitive's API, named waits, comments and marked lines alone", () => {
    const none = (src: string) => assert.deepEqual(findRawWaits(src), [], src);
    none(`<WaitState label="Loading your tracker" skeleton={<WaitBar className="h-4" />} />`);
    none(`{pending && <InlineSpinner size={16} />}`);
    none(`<SettingsSectionLoading label="Loading connected agents…" />`);
    none(`// was <Skeleton /> with animate-spin\n<WaitBar />`);
    none(`{/* Loading… used to show here */}`);
    none(`<Icon className="animate-spin" /> {/* wait-state-ok: decorative refresh glyph */}`);
    none(`// wait-state-ok: the primitive's own spinner\nreturn <CircleNotch className="animate-spin" />;`);
});

test("detector: a marker covers only its own line and the next, never a whole block", () => {
    const src = `// wait-state-ok: one exempt spinner\n<CircleNotch />\n<CircleNotch />`;
    assert.deepEqual(findRawWaits(src).map((h) => h.line), [3]);
});
