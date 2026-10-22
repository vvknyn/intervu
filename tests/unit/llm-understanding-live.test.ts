import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, createLruCache, parseIntent, type ParsedIntent } from "../../src/lib/jobs/llm-understanding/parse";
import type { JobSearchIntent } from "../../src/lib/jobs/llm-understanding/schema";
import { understandingRungs } from "../../src/lib/jobs/llm-understanding";
import { ProviderFactory } from "../../src/lib/llm/providers";
import fixtures from "./fixtures/nl-search-intents.json";

/** Grades the live free ladder against the fixtures per their `_grading` note.
 *  Opt-in: RUN_LIVE_LADDER=1 and JOBS_LLM_UNDERSTANDING=1 (needs OPENROUTER_API_KEY; spends free-tier calls). */
const set = (xs: string[]) => [...new Set(xs.map((x) => x.toLowerCase().trim()))].sort();
function grade(got: JobSearchIntent, want: JobSearchIntent): string[] {
    const bad: string[] = [];
    if (JSON.stringify(set(got.titles)) !== JSON.stringify(set(want.titles))) bad.push("titles");
    if (JSON.stringify(set(got.terms)) !== JSON.stringify(set(want.terms))) bad.push("terms");
    if (JSON.stringify(set(got.exclude_titles)) !== JSON.stringify(set(want.exclude_titles))) bad.push("exclude");
    for (const k of ["work_mode", "employment_type", "min_years", "experience_level", "posted_within_days"] as const) {
        if (got[k] !== want[k]) bad.push(k);
    }
    for (const k of ["country", "state", "city"] as const) {
        if ((got.location[k] ?? null) !== (want.location[k] ?? null)) bad.push(`location.${k}`);
    }
    if (got.min_salary.amount !== want.min_salary.amount || got.min_salary.currency !== want.min_salary.currency) bad.push("salary");
    for (const u of want.unparsed) {
        if (!got.unparsed.some((g) => g.toLowerCase().includes(u.toLowerCase()))) bad.push(`unparsed:${u}`);
    }
    return bad;
}

test("live ladder grading over all fixtures", { skip: !process.env.RUN_LIVE_LADDER || process.env.JOBS_LLM_UNDERSTANDING !== "1" }, async () => {
    const apiKey = process.env.OPENROUTER_API_KEY ?? "";
    const rungs = await understandingRungs();
    const latencies: number[] = [];
    const models: Record<string, number> = {};
    let pass = 0;
    for (const c of fixtures.cases) {
        const t0 = Date.now();
        const r: ParsedIntent | null = await parseIntent(c.q, {
            rungs,
            cache: createLruCache<ParsedIntent>(5),
            generate: async (rung, prompt) => {
                const res = await ProviderFactory.getProvider("openrouter", apiKey, rung.model).generate({
                    prompt, system: "Return ONLY valid JSON.", json: true, timeoutMs: rung.timeoutMs, maxRetries: 1,
                });
                if (res.error) throw new Error(res.error);
                return res.text;
            },
        });
        latencies.push(Date.now() - t0);
        const bad = r ? grade(r.intent, c.expect as JobSearchIntent) : ["no-answer"];
        if (r) models[r.model] = (models[r.model] ?? 0) + 1;
        if (!bad.length) pass++;
        else console.log(`MISS ${cacheKey(c.q).slice(0, 50)} -> ${bad.join(",")}`);
    }
    latencies.sort((a, b) => a - b);
    const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];
    console.log(`LIVE pass=${pass}/${fixtures.cases.length} models=${JSON.stringify(models)} p50=${pct(0.5)}ms p95=${pct(0.95)}ms`);
    assert.ok(pass > 0);
});
