#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

function parseArgs() {
    const args = process.argv.slice(2);
    let base = "http://127.0.0.1:3000";
    let out = join(process.cwd(), "lighthouse-out");
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--base" && args[i + 1]) base = args[++i];
        else if (args[i] === "--out" && args[i + 1]) out = args[++i];
    }
    return { base: base.replace(/\/$/, ""), out };
}

function summarize(lhr) {
    const perf = Math.round(lhr.categories.performance.score * 100);
    const a = lhr.audits;
    return {
        performance: perf,
        cls: a["cumulative-layout-shift"]?.displayValue ?? null,
        lcp: a["largest-contentful-paint"]?.displayValue ?? null,
        tbt: a["total-blocking-time"]?.displayValue ?? null,
    };
}

async function runAudit(url, chrome) {
    const result = await lighthouse(url, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: ["performance"],
        formFactor: "mobile",
        screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75 },
    });
    const lhr = result.lhr ?? (typeof result.report === "string" ? JSON.parse(result.report) : null);
    if (!lhr) throw new Error("Lighthouse returned no LHR payload");
    return lhr;
}

async function seedBrowseState(base) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}/jobs`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
        localStorage.setItem("velai.onboarding.completed", "1");
    });
    await page.goto(`${base}/jobs?view=search&q=software`, { waitUntil: "networkidle", timeout: 60_000 });
    await browser.close();
}

async function main() {
    const { base, out } = parseArgs();
    await mkdir(out, { recursive: true });
    await seedBrowseState(base);

    const chrome = await chromeLauncher.launch({
        chromeFlags: ["--headless", "--no-sandbox", "--disable-gpu"],
    });

    const scenarios = [
        { name: "jobs-landing-mobile", url: `${base}/jobs` },
        { name: "jobs-browse-mobile", url: `${base}/jobs?view=search&q=software` },
    ];

    const summary = { base, scenarios: {} };

    for (const scenario of scenarios) {
        const lhr = await runAudit(scenario.url, chrome);
        await writeFile(join(out, `${scenario.name}.json`), JSON.stringify(lhr));
        summary.scenarios[scenario.name] = { url: scenario.url, ...summarize(lhr) };
        console.log(JSON.stringify({ scenario: scenario.name, ...summary.scenarios[scenario.name] }));
    }

    await chrome.kill();
    await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
