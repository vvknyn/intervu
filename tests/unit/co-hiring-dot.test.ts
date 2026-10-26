import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HiringDot } from "@/components/company/HiringDot";
import { buildCompanyHiringAnswer } from "@/lib/companies/presentation";
import type { CompanyPageData } from "@/lib/companies/types";
import type { PublicJob } from "@/lib/jobs/types";

const NOW = Date.parse("2026-10-26T00:00:00Z");
const DAY_MS = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

const job = (id: string, checkedDaysAgo: number | null) =>
  ({ id, title: "Engineer", ghost_badge: "clear", ghost_checked_at: checkedDaysAgo === null ? null : iso(checkedDaysAgo) }) as unknown as PublicJob;

const answer = (jobs: PublicJob[], openCount = jobs.length) =>
  buildCompanyHiringAnswer({ openCount, openCountIsLowerBound: false, jobs } as Pick<CompanyPageData, "openCount" | "openCountIsLowerBound" | "jobs">, NOW);
const dotHtml = (a: ReturnType<typeof answer>) => renderToStaticMarkup(createElement(HiringDot, { dot: a.dot }));

describe("/co header dot follows the same freshness fact as the headline", () => {
  const fresh = answer([job("a", 1)]);
  const stale = answer([job("a", 52)]);
  const unstamped = answer([job("a", null)]);

  it("fresh: green Live dot beside 'live on Velai right now'", () => {
    assert.match(fresh.headline, /live on Velai right now/);
    const html = dotHtml(fresh);
    assert.match(html, /bg-live/);
    assert.match(html, /aria-label="Live"/);
  });

  it("stale: neutral Not recently verified dot beside 'last checked'", () => {
    assert.match(stale.headline, /listed on Velai, last checked/);
    const html = dotHtml(stale);
    assert.doesNotMatch(html, /bg-live/);
    assert.match(html, /bg-st-intv/);
    assert.match(html, /aria-label="Not recently verified"/);
  });

  it("no check stamp at all: not green either", () => {
    assert.equal(unstamped.headline, "1 open role listed on Velai");
    const html = dotHtml(unstamped);
    assert.doesNotMatch(html, /bg-live/);
    assert.match(html, /aria-label="Not recently verified"/);
  });

  it("no open roles: no dot", () => {
    assert.equal(dotHtml(answer([], 0)), "");
  });
});
