import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POSTHOG_OPTIONS } from "@/lib/posthog-options";
import { TELEMETRY_LEDGER_RETAIN_DAYS } from "@/lib/telemetry/retention";
import { TELEMETRY_LEDGER_FIELDS_DISCLOSED } from "@/lib/telemetry/public-disclosure";

const ROOT = join(__dirname, "..", "..");

if (!process.env.NEXT_PUBLIC_SITE_URL) {
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
}

function privacyArticle(): string {
  const src = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
  const article = src.split("<article")[1]?.split("</article>")[0] ?? src;
  return article.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** User-visible strings on /privacy — article body plus meta description. */
function privacyUserVisibleCopy(): string {
  const src = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
  const description =
    src.match(/const DESCRIPTION = "([^"]+)"/)?.[1] ??
    src.match(/const DESCRIPTION = '([^']+)'/)?.[1] ??
    "";
  const article = privacyArticle();
  const stripped = article
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/&apos;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&");
  return `${description}\n${stripped}`;
}

/** Standalone lowercase product name — not velai.app URLs or code identifiers. */
const STANDALONE_LOWERCASE_VELAI = /(?<![@./a-z0-9-])\bvelai\b(?![a-z0-9.-])/;

/** Résumé nouns in article prose should use the accented spelling (not the verb "resume email"). */
const UNACCENTED_RESUME_NOUN = /\b(?:saved|your|tailored|parsed|full|raw)\s+resume(s)?\b/i;

describe("privacy article — owner-confirmed analytics & processors", () => {
  it("uses Velai brand casing in user-visible copy (never standalone lowercase velai)", () => {
    const visible = privacyUserVisibleCopy();
    assert.doesNotMatch(
      visible,
      STANDALONE_LOWERCASE_VELAI,
      "standalone lowercase velai in /privacy user-visible copy — use Velai",
    );
    assert.match(visible, /\bVelai\b/, "expected at least one Velai brand reference");
  });

  it("inline code labels in the article use text-foreground for card contrast", () => {
    const article = privacyArticle();
    const classNames = [...article.matchAll(/<code className="([^"]+)">/g)].map((m) => m[1]!);
    assert.ok(classNames.length >= 5, "expected inline code labels in /privacy article");
    for (const className of classNames) {
      assert.match(
        className,
        /\btext-foreground\b/,
        `<code className="${className}"> must include text-foreground for AA contrast on bg-card`,
      );
    }
  });

  it("uses résumé spelling consistently for résumé nouns in the article", () => {
    const articleText = privacyArticle()
      .replace(/<[^>]+>/g, " ")
      .replace(/\{[^}]+\}/g, " ")
      .replace(/&apos;/g, "'");
    assert.doesNotMatch(
      articleText,
      UNACCENTED_RESUME_NOUN,
      "unaccented resume noun in /privacy article — use résumé",
    );
    assert.match(articleText, /saved résumés/i);
    assert.match(articleText, /not resume email after you leave/i, "verb resume email unchanged");
  });

  it("PostHog client config uses US UI host and masks replay inputs", () => {
    assert.equal(POSTHOG_OPTIONS.ui_host, "https://us.posthog.com");
    assert.equal(POSTHOG_OPTIONS.session_recording?.maskAllInputs, true);
  });

  it("discloses shared PostHog project, US cloud, replay retention, and IP storage", () => {
    const prose = privacyArticle();
    assert.match(prose, /thesubspace\.io/i);
    assert.match(prose, /us\.posthog\.com/i);
    assert.match(prose, /session replay is enabled/i);
    assert.match(prose, /30 days/i);
    assert.match(prose, /IP addresses are stored/i);
    assert.match(prose, /Input masking is on/i);
  });

  it("discloses Meilisearch and Subspace only for flows code actually sends", () => {
    const prose = privacyArticle();
    assert.match(prose, /Meilisearch/i);
    assert.match(prose, /Subspace/i);
    assert.match(prose, /rank-by-fit|For you/i);
    assert.match(prose, /experience role titles|top skill names/i);
    assert.match(prose, /do not send your full résumé file or raw résumé[\s\S]*text to Meilisearch/i);
    assert.match(prose, /job identifiers[\s\S]*only, not your résumé or search queries/i);
    assert.match(prose, /job URL/i);
    assert.match(prose, /reporter_key/i);
  });

  it("telemetry ledger fields match code-owned disclosure list and 90-day retention", () => {
    const pageSrc = readFileSync(join(ROOT, "src/app/privacy/page.tsx"), "utf8");
    assert.match(pageSrc, /from "@\/lib\/telemetry\/public-disclosure"/);
    assert.match(pageSrc, /TELEMETRY_LEDGER_FIELDS_DISCLOSED\.join\(", "\)/);
    assert.match(privacyArticle(), new RegExp(`${TELEMETRY_LEDGER_RETAIN_DAYS} days`));
    assert.ok(TELEMETRY_LEDGER_FIELDS_DISCLOSED.length >= 12);
  });
});
