import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PULSE = join(__dirname, "..", "..", "src", "components", "trends", "MarketPulse.tsx");
const WORK = join(__dirname, "..", "..", "src", "components", "trends", "WorkArrangementDistribution.tsx");

/** Shared max scales every bar in a row chart — not per-row normalization. */
export function barWidthPct(value: number, values: number[]): number {
    const max = Math.max(...values, 1);
    return (value / max) * 100;
}

describe("barWidthPct", () => {
    it("maps higher counts to longer bars under one shared max", () => {
        const values = [36_792, 42_691];
        assert.ok(barWidthPct(42_691, values) > barWidthPct(36_792, values));
    });

    it("uses 100% width for the max value", () => {
        assert.equal(barWidthPct(500, [100, 500, 200]), 100);
    });
});

describe("MarketPulse bar scale", () => {
    it("derives one maxValue for all ingestion-velocity rows", () => {
        const src = readFileSync(PULSE, "utf8");
        assert.match(src, /const maxValue = Math\.max\(\.\.\.postedPerDay\.map\(\(d\) => d\.count\.value\)/);
        assert.match(src, /count\.value \/ maxValue/);
        assert.doesNotMatch(src, /Math\.max\([^)]*postedPerDay\.map[\s\S]*?\)[\s\S]*?count\.value \/ maxValue[\s\S]*?Math\.max\([^)]*postedPerDay\.map/);
    });
});

describe("Workplace Flexibility legend", () => {
    it("labels stacked bar segments from the same workTypes data", () => {
        const src = readFileSync(WORK, "utf8");
        const barBlock = src.slice(src.indexOf("High-contrast multi-segment"), src.indexOf("<ol className=\"mt-4 space-y-1.5\">"));
        assert.match(barBlock, /workTypes\.map/);
        assert.match(barBlock, /item\.label/);
        assert.match(barBlock, /item\.pct/);
    });
});
