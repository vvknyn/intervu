#!/usr/bin/env node
/**
 * Lighthouse perf-deep — 3 runs per scenario, median metrics.
 * Usage: node scripts/lighthouse-perf-deep.mjs --base http://127.0.0.1:3021 --out /path/to/perf-deep/after
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { chromium } from "playwright";

function parseArgs() {
    const args = process.argv.slice(2);
    let base = "http://127.0.0.1:3021";
    let out = join(process.cwd(), "lighthouse-out");
    let runs = 3;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--base" && args[i + 1]) base = args[++i];
        else if (args[i] === "--out" && args[i + 1]) out = args[++i];
        else if (args[i] === "--runs" && args[i + 1]) runs = Number(args[++i]);
    }
    return { base: base.replace(/\/$/, ""), out, runs };
}

function metric(lhr, id) {
    const a = lhr.audits[id];
    return a?.numericValue ?? null;
}

function summarize(lhr) {
    return {
        performance: Math.round(lhr.categories.performance.score * 100),
        lcpMs: metric(lhr, "largest-contentful-paint"),
        cls: metric(lhr, "cumulative-layout-shift"),
        tbtMs: metric(lhr, "total-blocking-time"),
        lcp: lhr.audits["largest-contentful-paint"]?.displayValue ?? null,
        clsDisplay: lhr.audits["cumulative-layout-shift"]?.displayValue ?? null,
        tbt: lhr.audits["total-blocking-time"]?.displayValue ?? null,
    };
}

function median(nums) {
    const s = nums.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
    if (!s.length) return null;
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medianSummary(rows) {
    return {
        performance: Math.round(median(rows.map((r) => r.performance)) ?? 0),
        lcpMs: median(rows.map((r) => r.lcpMs)),
        cls: median(rows.map((r) => r.cls)),
        tbtMs: median(rows.map((r) => r.tbtMs)),
        lcp: rows[0]?.lcp,
        clsDisplay: rows[Math.floor(rows.length / 2)]?.clsDisplay,
        tbt: rows[0]?.tbt,
    };
}

async function runAudit(url, chrome, formFactor) {
    const mobile = formFactor === "mobile";
    const result = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
        formFactor: mobile ? "mobile" : "desktop",
        screenEmulation: mobile
            ? { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 }
            : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
    });
    const lhr = result.lhr ?? (typeof result.report === "string" ? JSON.parse(result.report) : null);
    if (!lhr) throw new Error("Lighthouse returned no LHR payload");
    return lhr;
}

async function seedOnboardingDone(base) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/jobs`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
        localStorage.setItem("velai.onboarding.completed", "1");
    });
    await browser.close();
}

async function main() {
    const { base, out, runs } = parseArgs();
    await mkdir(out, { recursive: true });
    await seedOnboardingDone(base);

    const chrome = await chromeLauncher.launch({
        chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
    });

    const scenarios = [
        { key: "jobs-landing-mobile", url: `${base}/jobs`, formFactor: "mobile" },
        { key: "jobs-onboarding-done-mobile", url: `${base}/jobs`, formFactor: "mobile", onboardingDone: true },
    ];

    const summary = { base, runs, scenarios: {} };

    for (const scenario of scenarios) {
        const rows = [];
        for (let i = 0; i < runs; i++) {
            if (scenario.onboardingDone) {
                const browser = await chromium.launch({ headless: true });
                const page = await browser.newPage();
                await page.goto(`${base}/jobs`, { waitUntil: "domcontentloaded" });
                await page.evaluate(() => localStorage.setItem("velai.onboarding.completed", "1"));
                await browser.close();
            } else {
                const browser = await chromium.launch({ headless: true });
                const page = await browser.newPage();
                await page.goto(`${base}/jobs`, { waitUntil: "domcontentloaded" });
                await page.evaluate(() => localStorage.removeItem("velai.onboarding.completed"));
                await browser.close();
            }
            const lhr = await runAudit(scenario.url, chrome, scenario.formFactor);
            const row = summarize(lhr);
            rows.push(row);
            await writeFile(join(out, `${scenario.key}-run${i + 1}.json`), JSON.stringify(lhr));
            console.log(JSON.stringify({ scenario: scenario.key, run: i + 1, ...row }));
        }
        summary.scenarios[scenario.key] = { url: scenario.url, runs: rows, median: medianSummary(rows) };
    }

    await chrome.kill();
    await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
