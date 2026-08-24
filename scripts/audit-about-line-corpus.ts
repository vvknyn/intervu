#!/usr/bin/env npx tsx
/**
 * One-off corpus audit for extractCompanyAboutLine — samples real company
 * domains from the elite board list, fetches jobs the same way getCompanyPageData
 * does, and flags pollution remaining after stripLeadingSectionLabels.
 *
 *   npx tsx scripts/audit-about-line-corpus.ts
 *
 * Env: loads /Users/vivek/Antigravity/Code/intervu/.env.local (MEILISEARCH_*).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import eliteDomains from "../data/boards/elite-domains.json";
import { extractCompanyAboutLine } from "../src/lib/companies/about-line";
import { resolveCompanyName } from "../src/lib/companies/company-name";
import { COMPANY_JOBS_FETCH_LIMIT } from "../src/lib/companies/get-company";
import { displayCompanyName, isInternalPosting } from "../src/lib/jobs/presentation";
import { isUnavailableJobsResult } from "../src/lib/jobs/result-state";
import { searchJobs } from "../src/lib/jobs/search";
import type { PublicJob } from "../src/lib/jobs/types";

const ENV_PATH = "/Users/vivek/Antigravity/Code/intervu/.env.local";
const TARGET_SAMPLE = 175;
const CONCURRENCY = 8;
const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "tmp", "about-line-corpus-audit.md");
const SEED = 42;

const SECTION_LABEL_RES: RegExp[] = [
  /\bwho we are\b/i,
  /\babout us\b/i,
  /\babout the company\b/i,
  /\bour mission\b/i,
  /\bcompany overview\b/i,
  /\bwhat we do\b/i,
  /\bour story\b/i,
];

const EEO_BOILERPLATE_RES: RegExp[] = [
  /equal opportunit/i,
  /how to apply/i,
  /benefits include/i,
  /reasonable accommodat/i,
  /E-Verify/i,
];

type RuleId =
  | "section-label"
  | "about-name-prefix"
  | "duplicate-name-glue"
  | "caps-heading-spill"
  | "markdown-leftover"
  | "length-truncation"
  | "eeo-boilerplate";

const RULE_LABELS: Record<RuleId, string> = {
  "section-label": "section-label",
  "about-name-prefix": "About {Name} prefix",
  "duplicate-name-glue": "duplicate-name-glue",
  "caps-heading-spill": "ALL-CAPS heading spill",
  "markdown-leftover": "markdown/HTML leftover",
  "length-truncation": "length/truncation",
  "eeo-boilerplate": "EEO/apply boilerplate",
};

function loadEnv(path: string): void {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m) process.env[m[1]!] = m[2]!;
    }
  } catch (err) {
    console.error(`Failed to load env from ${path}:`, err);
    process.exit(1);
  }
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function detectPollution(oneLiner: string): RuleId[] {
  const rules: RuleId[] = [];
  const t = oneLiner.trim();

  if (SECTION_LABEL_RES.some((re) => re.test(t))) rules.push("section-label");
  if (/^about\s+\w+/i.test(t)) rules.push("about-name-prefix");
  if (/^([A-Z][\w.&'-]+)\s+\1\b/.test(t)) rules.push("duplicate-name-glue");

  const capsSpill = t.match(/^([A-Z][A-Z0-9 &/-]{8,})([a-z].*)$/);
  if (capsSpill && !capsSpill[1]!.includes(".")) rules.push("caps-heading-spill");

  if (/\*\*|##|<p>|&nbsp;/i.test(t)) rules.push("markdown-leftover");

  const endsWithPunct = /[.!?]["']?$/.test(t);
  const endsMidWord = /[a-zA-Z]$/.test(t) && t.length > 80;
  if (t.length > 220 || (!endsWithPunct && endsMidWord)) rules.push("length-truncation");

  if (EEO_BOILERPLATE_RES.some((re) => re.test(t))) rules.push("eeo-boilerplate");

  return rules;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

type DomainResult = {
  domain: string;
  name: string;
  jobCount: number;
  descCount: number;
  oneLiner: string | null;
  rules: RuleId[];
};

async function auditDomain(domain: string): Promise<DomainResult | "skip-no-desc" | "skip-unavailable"> {
  const result = await searchJobs({
    companyDomain: domain,
    limit: COMPANY_JOBS_FETCH_LIMIT,
    hideGhosts: false,
  });

  if (isUnavailableJobsResult(result)) return "skip-unavailable";

  const jobs: PublicJob[] = result.hits.filter((job) => !isInternalPosting(job.title));
  const descCount = jobs.filter((j) => !!j.description?.trim()).length;
  if (descCount === 0) return "skip-no-desc";

  const name = displayCompanyName(resolveCompanyName(jobs, domain).value);
  const oneLiner = extractCompanyAboutLine(jobs, name);
  const rules = oneLiner ? detectPollution(oneLiner) : [];

  return { domain, name, jobCount: jobs.length, descCount, oneLiner, rules };
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function pickRandomClean(examples: DomainResult[], count: number, rand: () => number): DomainResult[] {
  const pool = [...examples];
  const picked: DomainResult[] = [];
  while (picked.length < count && pool.length > 0) {
    const i = Math.floor(rand() * pool.length);
    picked.push(pool.splice(i, 1)[0]!);
  }
  return picked;
}

function countRules(rows: DomainResult[]): Map<RuleId, number> {
  const counts = new Map<RuleId, number>();
  for (const row of rows) {
    for (const r of row.rules) counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return counts;
}

function buildReport(
  sampled: DomainResult[],
  skippedNoDesc: number,
  skippedUnavailable: number,
  domainsAttempted: number,
): string {
  const nullCount = sampled.filter((r) => r.oneLiner === null).length;
  const extracted = sampled.filter((r) => r.oneLiner !== null);
  const polluted = extracted.filter((r) => r.rules.length > 0);
  const clean = extracted.filter((r) => r.rules.length === 0);
  const pollutedPct = extracted.length ? ((polluted.length / extracted.length) * 100).toFixed(1) : "0.0";
  const nullPct = ((nullCount / sampled.length) * 100).toFixed(1);

  const ruleCounts = countRules(polluted);
  const sortedRules = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]);

  const rand = mulberry32(SEED + 1);
  const cleanSamples = pickRandomClean(clean, Math.min(10, clean.length), rand);

  const pollutedSorted = [...polluted].sort((a, b) => a.domain.localeCompare(b.domain));

  let md = `# About-line corpus audit\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n| --- | ---: |\n`;
  md += `| Domains attempted | ${domainsAttempted} |\n`;
  md += `| Skipped (no descriptions) | ${skippedNoDesc} |\n`;
  md += `| Skipped (search unavailable) | ${skippedUnavailable} |\n`;
  md += `| **Sample size** (domains with descriptions) | **${sampled.length}** |\n`;
  md += `| Null (extractor returned null) | ${nullCount} (${nullPct}%) |\n`;
  md += `| Extracted non-null | ${extracted.length} |\n`;
  md += `| Clean (non-null, no rules fired) | ${clean.length} |\n`;
  md += `| **Polluted** (non-null, ≥1 rule) | **${polluted.length}** (${pollutedPct}% of extracted) |\n\n`;

  md += `### Top remaining failure modes\n\n`;
  if (sortedRules.length === 0) {
    md += `_No pollution detected in extracted lines._\n\n`;
  } else {
    for (const [rule, count] of sortedRules) {
      md += `- **${RULE_LABELS[rule]}**: ${count} (${((count / polluted.length) * 100).toFixed(1)}% of polluted)\n`;
    }
    md += `\n`;
  }

  if (Number.parseFloat(pollutedPct) > 5) {
    md += `### Proposed additional strip patterns\n\n`;
    const proposals: string[] = [];
    if ((ruleCounts.get("section-label") ?? 0) >= 3) {
      proposals.push(
        `- Extend \`GENERIC_SECTION_LABEL_RES\` with labels seen in failures (e.g. \`What we do\`, \`Our story\`) — evidence in polluted table below.`,
      );
    }
    if ((ruleCounts.get("about-name-prefix") ?? 0) >= 3) {
      proposals.push(
        `- Re-run \`stripLeadingSectionLabels\` after \`selectSentence\` if mid-sentence glue survives, or broaden \`aboutHeadingRegex\` stripping when label appears after other prefixes.`,
      );
    }
    if ((ruleCounts.get("caps-heading-spill") ?? 0) >= 3) {
      proposals.push(
        `- Add post-\`formatDescription\` cleanup for Title-case glued headings (not just ALL-CAPS) — upstream in format-description or a final strip pass.`,
      );
    }
    if ((ruleCounts.get("markdown-leftover") ?? 0) >= 3) {
      proposals.push(
        `- Strip residual markdown/HTML tokens (\`**\`, \`##\`, \`<p>\`) in \`stripLeadingSectionLabels\` or decode pass before sentence selection.`,
      );
    }
    if (proposals.length === 0) {
      md += `_Pollution >5% but no single pattern has ≥3 examples — review polluted table manually._\n\n`;
    } else {
      md += proposals.join("\n") + "\n\n";
    }
  }

  md += `## Polluted examples (${polluted.length})\n\n`;
  if (pollutedSorted.length === 0) {
    md += `_None._\n\n`;
  } else {
    md += `| Domain | One-liner (≤160 chars) | Rules fired |\n| --- | --- | --- |\n`;
    for (const row of pollutedSorted) {
      const rules = row.rules.map((r) => RULE_LABELS[r]).join(", ");
      md += `| ${row.domain} | ${truncate(row.oneLiner!, 160).replace(/\|/g, "\\|")} | ${rules} |\n`;
    }
    md += `\n`;
  }

  md += `## Clean spot-check (10 random)\n\n`;
  if (cleanSamples.length === 0) {
    md += `_No clean examples._\n\n`;
  } else {
    md += `| Domain | One-liner |\n| --- | --- |\n`;
    for (const row of cleanSamples) {
      md += `| ${row.domain} | ${truncate(row.oneLiner!, 160).replace(/\|/g, "\\|")} |\n`;
    }
    md += `\n`;
  }

  return md;
}

async function main(): Promise<void> {
  loadEnv(ENV_PATH);

  const rand = mulberry32(SEED);
  const domains = shuffle(
    (eliteDomains as string[]).map((d) => d.trim().toLowerCase()).filter(Boolean),
    rand,
  );

  const sampled: DomainResult[] = [];
  let skippedNoDesc = 0;
  let skippedUnavailable = 0;
  let domainsAttempted = 0;
  let cursor = 0;

  console.log(`Auditing up to ${TARGET_SAMPLE} domains from ${domains.length} elite-board domains…`);

  while (sampled.length < TARGET_SAMPLE && cursor < domains.length) {
    const batchSize = Math.min(CONCURRENCY * 4, domains.length - cursor, TARGET_SAMPLE - sampled.length + CONCURRENCY * 2);
    const batch = domains.slice(cursor, cursor + batchSize);
    cursor += batchSize;
    domainsAttempted += batch.length;

    const results = await mapPool(batch, CONCURRENCY, auditDomain);

    for (const r of results) {
      if (r === "skip-no-desc") {
        skippedNoDesc++;
        continue;
      }
      if (r === "skip-unavailable") {
        skippedUnavailable++;
        console.error("Search unavailable — check MEILISEARCH_* env");
        process.exit(1);
      }
      sampled.push(r);
      if (sampled.length >= TARGET_SAMPLE) break;
    }

    process.stdout.write(`\r  sampled ${sampled.length}/${TARGET_SAMPLE} (attempted ${domainsAttempted})`);
  }

  console.log("");

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  const report = buildReport(sampled, skippedNoDesc, skippedUnavailable, domainsAttempted);
  writeFileSync(REPORT_PATH, report, "utf8");

  const nullCount = sampled.filter((r) => r.oneLiner === null).length;
  const extracted = sampled.filter((r) => r.oneLiner !== null);
  const polluted = extracted.filter((r) => r.rules.length > 0);

  console.log(`\nReport: ${REPORT_PATH}`);
  console.log(`Sample: ${sampled.length} | null: ${nullCount} | clean: ${extracted.length - polluted.length} | polluted: ${polluted.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
