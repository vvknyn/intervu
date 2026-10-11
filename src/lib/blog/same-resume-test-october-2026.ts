import type { BlogPost } from "./posts";

const DIR = "/blog/same-resume-test-october-2026";
const HIRINGCAFE_COST_POST = "https://www.reddit.com/r/hiringcafe/comments/1www5yu/some_changes_and_freebies/";

/**
 * Vivek's same-résumé test of Velai's For you list against HiringCafe's
 * Talent Agent (Oct 8, 2026). Every number comes from that study's write-up;
 * the p-value is Fisher's exact test on 17/20 vs 13/20 (0.273). The gap is
 * within chance, so the post says so and reports what Velai got wrong too.
 * HiringCafe's per-search cost is their own words, linked.
 *
 * The chart is drawn from the same numbers (no real person or résumé in it).
 */
export const SAME_RESUME_TEST_OCTOBER_2026: BlogPost = {
    slug: "same-resume-test-october-2026",
    title: "Same résumé, two job searches: what a small test showed us",
    searchTitle: "Velai vs HiringCafe: same résumé, two job searches",
    description:
        "We gave Velai and HiringCafe's Talent Agent the same résumé and blind-scored the top 20 jobs from each. The numbers, their limits, and what we got wrong.",
    datePublished: "2026-10-09",
    author: { name: "Vivek", role: "founder of Velai" },
    cover: `${DIR}/results.png`,
    images: {
        [`${DIR}/results.png`]: { width: 2400, height: 1260 },
    },
    body: `
On October 8 we put Velai next to HiringCafe's new Talent Agent. We used the same résumé on the same day, took the top 20 jobs each one returned, and scored all 40 without seeing which service each came from. The résumé was a product and program manager's, looking in the Toronto area or remote in Canada. On Velai that meant the For you list. HiringCafe's Talent Agent was asked for roles posted in the last 30 days.

That's one résumé and 20 jobs a side, so read this as a look under the hood, not a verdict.

![Bar chart of the top 20 jobs from each service. Worth applying to: Velai 85%, HiringCafe 65%. Posted in the last 30 days: 100% and 67%. Right kind of role: 100% and 80%. Location fits: 90% each. Apply link still live: 95% and 90%. Salary shown: 90% and 80%.](${DIR}/results.png)

## What the numbers say

17 of Velai's 20 jobs were worth applying to, meaning the right kind of role, in a place the person can work, with an apply link that still worked. For HiringCafe it was 13 of 20. With only 20 jobs a side, a gap that size can come from chance (p = 0.27), so we aren't calling it a win.

The clearest difference was freshness. All 20 of Velai's jobs were posted in the last 30 days. About two thirds of HiringCafe's were, even though its Talent Agent was asked for the last 30 days.

Role fit went the same way, 20 of 20 against 16 of 20, with HiringCafe's list including director-level roles. Location was a tie at 18 of 20 each.

## What a search costs

HiringCafe has said a Talent Agent search costs it about $1, because it compares your search against 20,000+ job descriptions with a language model ([their post](${HIRINGCAFE_COST_POST})).

Velai works differently. The search itself is ordinary search with no AI call, so a search costs us nothing in AI. That's what lets Velai stay free. AI only helps read and tailor your résumé: your name and contact details are taken out first, and it runs on a sealed server that we can't read.

*Updated October 11, 2026: when this was written, that AI was a small model running in your browser. It now runs on a sealed server, because the in-browser model failed on phones and slower laptops. [How Velai keeps your résumé private](/privacy#your-resume).*

## What we got wrong

The test turned up problems on our side too. These are on our list:

- The fit score gave all 20 jobs the same 100, so it isn't ranking anything within a list yet.
- Four jobs were labelled remote when they aren't.
- One posting that now returns "410 Gone" was still showing as active.
- HiringCafe found strong roles at four companies, posted inside our 30-day window, that didn't make Velai's top 20.
- In a run with a second résumé, a preference to leave out customer-facing roles wasn't applied.

## How we ran it

- One résumé, used on both services on October 8, 2026.
- Velai: the For you list. HiringCafe: the Talent Agent, asked for roles posted in the last 30 days.
- The top 20 from each, scored without knowing which service each job came from.
- Each job was checked for the right kind of role for the résumé, a location the person can work in, a live apply link, salary shown, and the date it was posted.
- "Worth applying to" means the first three all held.
- The p-value is Fisher's exact test on 17 of 20 against 13 of 20.

If you'd like to run the same test on your own résumé, [try Velai](/jobs) and tell us where it gets your list wrong.
`.trim(),
};
