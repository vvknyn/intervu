import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A signed-out "you need an account" prompt is `SignupGate`
 * (src/components/auth/SignupGate.tsx), or the auth dialog it sits beside.
 * A .tsx line that hand-rolls one — sign-in / create-account prose, or a
 * hard-coded /login or /auth/start href — must say on that line why it is not
 * a conversion gate: `signup-gate-exempt: <reason>`. Adding a new hand-rolled
 * prompt forces its author to route through the primitive or to say why not.
 * The sanctioned href builder (`signupGateHrefs`) lives in a .ts file.
 * No file allowlist.
 */
const PROMPT = /\b(create (a |your )?(free )?account\b|sign (in|up) (to|for|first)\b|log ?in to\b)/i;
const AUTH_HREF = /["'`]\/(auth\/start|login)(?=[?"'`/$])/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\{\/\*)/;
const MARKER = /signup-gate-exempt: \S.{14,}/;

export function findHandRolledGates(source: string): { line: number; text: string }[] {
    return source
        .split("\n")
        .map((text, i) => ({ line: i + 1, text }))
        .filter(({ text }) => !COMMENT_LINE.test(text) && (PROMPT.test(text) || AUTH_HREF.test(text)))
        .filter(({ text }) => !MARKER.test(text));
}

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : name.endsWith(".tsx") ? [p] : [];
    });
}

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("signed-out gates go through SignupGate", () => {
    it("no .tsx line hand-rolls a sign-in prompt without an exemption reason", () => {
        const bare = walk(SRC).flatMap((file) =>
            findHandRolledGates(readFileSync(file, "utf8")).map((l) => `${file.slice(SRC.length + 1)}:${l.line}  ${l.text.trim().slice(0, 90)}`),
        );
        assert.deepEqual(bare, []);
    });

    it("the scan finds the exempted prompts (guards against it silently matching nothing)", () => {
        const exempt = walk(SRC).flatMap((file) => readFileSync(file, "utf8").split("\n").filter((t) => MARKER.test(t)));
        assert.ok(exempt.length >= 10, `only ${exempt.length} exempt lines found`);
    });

    it("flags a hand-rolled gate that is NOT the one that motivated this (negative controls)", () => {
        // Prose, an href, and a create-account label: three different spellings.
        assert.equal(findHandRolledGates(`<p>Sign in to save this job</p>`).length, 1);
        assert.equal(findHandRolledGates(`<a href="/login?next=/jobs">Continue</a>`).length, 1);
        assert.equal(findHandRolledGates("<Button>Create your free account</Button>").length, 1);
        assert.equal(findHandRolledGates("window.location.href = `/auth/start?mode=signup`;").length, 1);
    });

    it("accepts an exemption with a real reason, rejects a bare or reasonless marker", () => {
        assert.equal(findHandRolledGates(`<p>Sign in to save</p> {/* signup-gate-exempt: the auth page itself, not a gate */}`).length, 0);
        assert.equal(findHandRolledGates(`<p>Sign in to save</p> {/* signup-gate-exempt: */}`).length, 1);
        assert.equal(findHandRolledGates(`<p>Sign in to save</p> {/* signup-gate-exempt: ok */}`).length, 1);
    });

    it("ignores prose that is not a prompt, and comment lines", () => {
        assert.equal(findHandRolledGates("<p>Sign in with Google, a passkey, or an email code.</p>").length, 0);
        assert.equal(findHandRolledGates("// Sign in to see this — explained in a comment").length, 0);
    });

    it("the gates this PR names all render the primitive with their reason", () => {
        const jobs = read("app/jobs/JobsContent.tsx");
        for (const reason of ["depth", "fit", "save"]) {
            assert.match(jobs, new RegExp(`<SignupGate[^>]*reason="${reason}"`), `JobsContent lacks SignupGate reason=${reason}`);
        }
        assert.match(read("components/jobs/SavedSearchesPanel.tsx"), /<SignupGate[^>]*reason="alert"/);
    });

    it("every ranked surface reads the fit-gated rows, never the whole ranked list", () => {
        const jobs = read("app/jobs/JobsContent.tsx");
        assert.match(jobs, /const renderedClusters = fitGate\.visible;/);
        // The ungated list feeds only the gate itself: declaration, `rows:`, deps.
        assert.equal(jobs.match(/\brankedClusters\b/g)?.length, 3, "a surface reads rankedClusters past the fit gate");
        assert.match(jobs, /\{fitGateEl\}/);
    });

    it("only the primitive renders the gate card", () => {
        const owners = walk(SRC).filter((f) => readFileSync(f, "utf8").includes('data-testid="signup-gate"'));
        assert.deepEqual(owners.map((f) => f.slice(SRC.length + 1)), ["components/auth/SignupGate.tsx"]);
    });
});
