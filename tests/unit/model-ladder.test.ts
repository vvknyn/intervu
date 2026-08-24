import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    resolveModelLadder,
    runLadder,
    FREE_RUNG_TIMEOUT_MS,
    PAID_RUNG_TIMEOUT_MS,
} from "@/lib/llm/model-ladder";
import { FREE_LADDER } from "@/lib/llm/models";

const ROOT = path.resolve(__dirname, "../..");
const PAID = "deepseek/deepseek-v4-flash";
const FREE = ["a/one:free", "b/two:free"];
const openrouter = { provider: "openrouter", model: PAID };

test("no ladder requested — one rung, the config's own model", () => {
    // The module's honest zero case: given no rungs there is nothing to walk.
    // No app caller takes this path any more (both chokepoints pass
    // FREE_LADDER), but the pure function must still answer sanely when handed
    // nothing rather than inventing a ladder of its own.
    const rungs = resolveModelLadder(openrouter);
    assert.deepEqual(rungs, [{ model: PAID, timeoutMs: PAID_RUNG_TIMEOUT_MS, isFallback: true }]);
});

test("ladder requested — free rungs first, the paid model last", () => {
    const rungs = resolveModelLadder(openrouter, FREE);
    assert.deepEqual(
        rungs.map((r) => r.model),
        [...FREE, PAID],
    );
    assert.deepEqual(
        rungs.map((r) => r.isFallback),
        [false, false, true],
        "only the final rung is the one that has to answer",
    );
});

test("the walk can never end on a free model", () => {
    // The reliability guarantee. Free slugs are withdrawn without notice, so a
    // ladder of only free rungs turns "cheaper" into "sometimes broken".
    for (const ladder of [FREE, ["only/one:free"], [...FREE, "c/three:free"]]) {
        const rungs = resolveModelLadder(openrouter, ladder);
        assert.equal(rungs.at(-1)?.model, PAID);
        assert.equal(rungs.at(-1)?.isFallback, true);
    }
});

test("a non-OpenRouter provider is never handed these slugs", () => {
    // Groq's namespace is `openai/gpt-oss-20b`, not `vendor/model:free`.
    // Walking an OpenRouter ladder on a Groq key would 404 every rung and turn
    // a working generation into a failure.
    const rungs = resolveModelLadder({ provider: "groq", model: "openai/gpt-oss-20b" }, FREE);
    assert.deepEqual(rungs.map((r) => r.model), ["openai/gpt-oss-20b"]);
});

test("an explicitly chosen model wins over the ladder", () => {
    const rungs = resolveModelLadder(openrouter, FREE, true);
    assert.deepEqual(rungs.map((r) => r.model), [PAID]);
});

test("the paid model is never tried twice", () => {
    // A ladder that happens to name the default would otherwise run it, fail,
    // and run it again as the tail — two identical round-trips.
    const rungs = resolveModelLadder(openrouter, [FREE[0], PAID]);
    assert.deepEqual(rungs.map((r) => r.model), [FREE[0], PAID]);
});

test("free rungs get less patience than the rung that has to answer", () => {
    // Someone is watching a spinner on their own résumé; the ladder's worst
    // case is the sum of its rungs.
    const rungs = resolveModelLadder(openrouter, FREE);
    assert.ok(FREE_RUNG_TIMEOUT_MS < PAID_RUNG_TIMEOUT_MS);
    assert.deepEqual(
        rungs.map((r) => r.timeoutMs),
        [FREE_RUNG_TIMEOUT_MS, FREE_RUNG_TIMEOUT_MS, PAID_RUNG_TIMEOUT_MS],
    );
});

test("the walk stops at the first success", async () => {
    const tried: string[] = [];
    const out = await runLadder(resolveModelLadder(openrouter, FREE), async (rung) => {
        tried.push(rung.model);
        return `answered by ${rung.model}`;
    });
    assert.equal(out, `answered by ${FREE[0]}`);
    assert.deepEqual(tried, [FREE[0]], "a successful rung must not fall through");
});

test("a failing rung falls through to the next", async () => {
    const tried: string[] = [];
    const out = await runLadder(resolveModelLadder(openrouter, FREE), async (rung) => {
        tried.push(rung.model);
        if (!rung.isFallback) throw new Error(`429 rate limited: ${rung.model}`);
        return "paid answered";
    });
    assert.equal(out, "paid answered");
    assert.deepEqual(tried, [...FREE, PAID], "every free rung is tried before the paid one");
});

test("running out of rungs propagates the LAST error", async () => {
    // The last rung is the one that was supposed to work, so its failure is
    // the one worth surfacing — not a free model's rate limit.
    await assert.rejects(
        runLadder(resolveModelLadder(openrouter, FREE), async (rung) => {
            throw new Error(`failed: ${rung.model}`);
        }),
        /failed: deepseek\/deepseek-v4-flash/,
    );
});

test("one generation is charged exactly once, however many rungs run", () => {
    // The invariant the credit policy rests on. `chargeIfSharedKey` bills one
    // credit per call, so a ladder walked by the CALLER (looping over
    // `generateGenericJSON`) would bill one credit per rung — three credits
    // for one résumé upload. The walk therefore has to sit inside the charge
    // boundary, and this asserts it stays there.
    const src = readFileSync(path.join(ROOT, "src/actions/generate-context.ts"), "utf8");
    const start = src.indexOf("export const fetchJSON");
    assert.ok(start > 0, "fetchJSON moved — this guard needs re-pointing");
    const body = src.slice(start, src.indexOf("\n};", start));

    const charges = body.match(/chargeIfSharedKey\(/g) || [];
    assert.equal(charges.length, 1, `fetchJSON charges ${charges.length} times per generation`);
    assert.ok(
        body.indexOf("chargeIfSharedKey(") < body.indexOf("runLadder("),
        "the charge must happen ABOVE the ladder walk, not per rung",
    );
});

test("the shipped ladder cannot hold a user longer than its budget", () => {
    // The failure this catches is adding "one more free rung" — each one is
    // free in money and 30s in someone's afternoon, and the cost lands on the
    // ONE path where a person is watching a spinner on their own résumé.
    // Worst case is the sum, so cap the sum rather than the rung count: a
    // future faster ladder is allowed to be longer.
    const rungs = resolveModelLadder(openrouter, FREE_LADDER);
    const worstCaseMs = rungs.reduce((sum, r) => sum + r.timeoutMs, 0);
    assert.ok(
        worstCaseMs <= 120_000,
        `a failing upload would wait ${worstCaseMs / 1000}s before erroring`,
    );
});

test("free rungs are given more time than they were measured to need", () => {
    // The bug this exists to prevent, caught in a live smoke test before it
    // shipped: the first draft's lead model answered correctly in 46.3s under a
    // 30s timeout. A timeout below a rung's real latency is worse than having
    // no ladder — it pays for the fallback AND adds the dead wait first. The
    // measurements live in the FREE_LADDER doc comment; this asserts the ones
    // recorded there are actually under the budget in force.
    const src = readFileSync(path.join(ROOT, "src/lib/llm/models.ts"), "utf8");
    const start = src.indexOf("export const FREE_LADDER");
    const doc = src.slice(0, start);

    for (const model of FREE_LADDER) {
        const measured = new RegExp(`${model}\\s+([\\d.]+)s`).exec(doc);
        assert.ok(measured, `${model} ships with no recorded latency — measure it`);
        assert.ok(
            Number(measured[1]) * 1000 < FREE_RUNG_TIMEOUT_MS,
            `${model} measured ${measured[1]}s, above the ${FREE_RUNG_TIMEOUT_MS / 1000}s rung timeout`,
        );
    }
});

test("BOTH generation chokepoints ladder by default", () => {
    // Owner's call reversed 2026-08-23: with the app funding every AI action,
    // every action walks the free rungs. The guard this replaces required each
    // caller to opt in — which is how `generateGenericText` went un-laddered
    // unnoticed: it never routed through fetchJSON, so opting in the JSON path
    // left a whole second path on the paid model.
    //
    // Asserted at the SEAMS, not at the ~17 call sites, because that is where
    // the property actually holds — a new caller is covered by construction.
    const src = readFileSync(path.join(ROOT, "src/actions/generate-context.ts"), "utf8");

    for (const [name, marker] of [
        ["fetchJSON", "export const fetchJSON"],
        ["generateGenericText", "export async function generateGenericText"],
    ] as const) {
        const start = src.indexOf(marker);
        assert.ok(start >= 0, `${name} is gone — this guard needs re-pointing`);
        const body = src.slice(start, start + 2200);
        assert.match(
            body,
            /resolveModelLadder\([^)]*FREE_LADDER/,
            `${name} no longer passes FREE_LADDER — a generation path is back on the paid model`,
        );
    }
});

test("a caller that names its own model gets THAT model, not a free rung", () => {
    // The override has to win, or naming a premium model would be answered by
    // a 9B free one — that defeats the override rather than economising on it.
    const rungs = resolveModelLadder(
        { provider: "openrouter", model: "deepseek/deepseek-v4-pro" },
        FREE_LADDER,
        true,
    );
    assert.deepEqual(rungs.map((r) => r.model), ["deepseek/deepseek-v4-pro"]);

    const src = readFileSync(path.join(ROOT, "src/actions/generate-context.ts"), "utf8");
    assert.match(
        src,
        /resolveModelLadder\(baseConfig, FREE_LADDER, Boolean\(configOverride\?\.model\)\)/,
        "fetchJSON must still let an explicit model skip the free rungs",
    );
});

test("fetchJSON passes per-rung timeout and single provider retry", () => {
    const src = readFileSync(path.join(ROOT, "src/actions/generate-context.ts"), "utf8");
    const start = src.indexOf("export const fetchJSON");
    const body = src.slice(start, src.indexOf("\n};", start));
    assert.match(body, /timeoutMs:\s*rung\.timeoutMs/);
    assert.match(body, /maxRetries:\s*1/);
});

test("with no override, the resolved model is the paid TAIL behind the free rungs", () => {
    const rungs = resolveModelLadder(
        { provider: "openrouter", model: "openai/gpt-4o-mini" },
        FREE_LADDER,
        false,
    );
    assert.equal(rungs.at(-1)?.model, "openai/gpt-4o-mini");
    assert.ok(rungs.length > 1);
    // The tail is the only rung allowed to be the paid one.
    assert.deepEqual(rungs.filter((r) => r.isFallback).map((r) => r.model), ["openai/gpt-4o-mini"]);
});
