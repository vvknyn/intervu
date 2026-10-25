import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSalaryMinDraft, SALARY_MIN_ERROR } from "../../src/components/jobs/SerpFilters";

test("a typed salary floor reads what people type, in whole dollars", () => {
    const cases: [string, number][] = [
        ["65000", 65000],
        ["$65,000", 65000],
        ["$120,000", 120000],
        ["120000", 120000],
        ["120,000", 120000],
        ["120k", 120000],
        ["120K", 120000],
        ["120.5k", 120500],
        ["$ 95k", 95000],
        ["  80000  ", 80000],
        ["120000.50", 120001],
        ["1,250,000", 1250000],
        ["", 0],
        ["   ", 0],
        ["0", 0],
    ];
    for (const [draft, want] of cases) assert.equal(parseSalaryMinDraft(draft), want, JSON.stringify(draft));
});

test("a draft we would have to guess at is rejected, never committed", () => {
    for (const draft of ["abc", "-5", "-100", "1.5e5", "12 0", "120k+", "1,2000", "12,34", "k", "$", "120kk", "1.2.3", "120 k", "NaN", "Infinity", "9".repeat(20)]) {
        assert.equal(parseSalaryMinDraft(draft), null, JSON.stringify(draft));
    }
});

test("the custom minimum opens the digit keypad on a phone", () => {
    const src = readFileSync(path.join(__dirname, "../../src/components/jobs/SerpFilters.tsx"), "utf8");
    const field = /<input\b(?:(?!\/>)[\s\S])*?data-testid="salary-custom-min"[\s\S]*?\/>/.exec(src)?.[0] ?? "";
    assert.match(field, /inputMode="numeric"/);
});

test("the error copy and placeholder only show amounts a digit keypad can type", () => {
    const src = readFileSync(path.join(__dirname, "../../src/components/jobs/SerpFilters.tsx"), "utf8");
    const placeholder = /data-testid="salary-custom-min"[\s\S]*?placeholder="e\.g\. ([^"]*)"|placeholder="e\.g\. ([^"]*)"[\s\S]*?data-testid="salary-custom-min"/.exec(src);
    const amounts = [SALARY_MIN_ERROR.match(/like (\S+?)\.?$/)?.[1], placeholder?.[1] ?? placeholder?.[2]];
    for (const amount of amounts) assert.match(amount ?? "", /^[0-9]+$/, String(amount));
});
