import type { Metadata } from "next";
import Link from "next/link";
import { buildArticleJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const HEADLINE = "Ghost jobs aren't the problem — wasted applications are";
const DESCRIPTION =
  "We scored 38,806 job listings from corporate ATS platforms. Only 6% are outright junk, but nearly half are missing the signals you need to decide if they're worth your time.";
// The article is a static July 2026 snapshot (see copy below); this file was
// last touched 2026-08-01 (`git log`), which is what dateModified reflects.
const DATE_PUBLISHED = "2026-07-01";
const DATE_MODIFIED = "2026-08-01";

export const metadata: Metadata = {
  title: HEADLINE,
  description: DESCRIPTION,
  ...canonicalMetadata("/research/ghost-jobs", HEADLINE, DESCRIPTION),
};

const articleJsonLd = buildArticleJsonLd({
  headline: HEADLINE,
  datePublished: DATE_PUBLISHED,
  dateModified: DATE_MODIFIED,
  description: DESCRIPTION,
  path: "/research/ghost-jobs",
});

// Squared "rtable" treatment (docs-mockup.html lines 281-284, "THE RULES" #4):
// one hairline border around the whole table, header cells mono/uppercase
// with no top border, every data-row cell gets a top hairline instead of a
// bottom one so hairlines live inside the table, never floating outside it.
// Single source of truth for all three tables on this page.
const RTABLE_TH =
  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
const RTABLE_TD = "border-t border-foreground/10 px-4 py-3";
const RTABLE = {
  table: "w-full border-collapse border border-foreground/10 text-[13.5px]",
  th: RTABLE_TH,
  thNum: `${RTABLE_TH} text-right`,
  td: RTABLE_TD,
  tdMono: `${RTABLE_TD}`,
  tdNum: `${RTABLE_TD} text-right`,
};

export default function GhostJobsResearchPage() {
  return (
    <main data-testid="research-ghost-jobs-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
        From our research · July 2026 snapshot
      </p>
      <h1 className="mt-3 font-display text-display font-extrabold text-foreground">
        Ghost Jobs Aren&apos;t the Problem. Wasted Applications Are.
      </h1>
      <p className="mt-1.5 text-sm italic text-muted-foreground">
        We scored 38,806 job listings from corporate ATS platforms. Only 6% are outright junk. But nearly half are
        missing the signals you need to know if they&apos;re worth your time.
      </p>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <p>
          The internet is obsessed with ghost jobs. &quot;50% of listings are fake.&quot; &quot;Companies post jobs
          they never intend to fill.&quot; It makes for great rage content.
        </p>
        <p>
          But after scoring 38,806 listings pulled directly from corporate hiring systems, we think the ghost job
          debate is a distraction from the actual problem.
        </p>
        <p>
          Most job listings aren&apos;t fake. They&apos;re just bad. And bad listings waste more of your time than
          fake ones ever could — because you can&apos;t tell the difference until you&apos;re three interviews deep.
        </p>

        <h2>The Real Numbers</h2>
        <p>
          This is a July 2026 snapshot of our scored corpus. We pull listings directly from corporate applicant
          tracking systems — Greenhouse, Ashby, Lever, SmartRecruiters, Workday, and 17 others. Not from Indeed. Not
          from LinkedIn. From the company&apos;s own hiring system.
        </p>
        <p>
          Every listing gets scored on freshness, description quality, salary transparency, employer signals, and
          role substance. Here&apos;s what <span className="verified-underline">38,806</span> listings
          across <span className="verified-underline">3,128</span> companies look like:
        </p>

        <div className="not-prose my-6 overflow-x-auto">
          <table className={RTABLE.table}>
            <thead>
              <tr>
                <th className={RTABLE.th}>Grade</th>
                <th className={RTABLE.th}>What it means</th>
                <th className={RTABLE.thNum}>Count</th>
                <th className={RTABLE.thNum}>Share</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={RTABLE.tdMono}>A</td>
                <td className={RTABLE.td}>Excellent — clear, fresh, transparent</td>
                <td className={RTABLE.tdNum}>80</td>
                <td className={RTABLE.tdNum}>0.2%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>B</td>
                <td className={RTABLE.td}>Good — solid listing, minor gaps</td>
                <td className={RTABLE.tdNum}>20,067</td>
                <td className={RTABLE.tdNum}>51.7%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>C</td>
                <td className={RTABLE.td}>Ambiguous — missing key signals</td>
                <td className={RTABLE.tdNum}>15,302</td>
                <td className={RTABLE.tdNum}>39.4%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>D–F</td>
                <td className={RTABLE.td}>Low quality — likely not worth applying</td>
                <td className={RTABLE.tdNum}>3,357</td>
                <td className={RTABLE.tdNum}>8.7%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          Only <span className="verified-underline">0.2%</span> of listings are excellent. Half are good
          enough. And nearly <span className="verified-underline">48.1%</span> are either ambiguous or
          worse.
        </p>
        <p>
          The 6% that are genuinely low quality? Those are the &quot;ghost jobs&quot; everyone is angry about. But
          they&apos;re the minority of the problem.
        </p>

        <h2>The Real Problem: 15,302 Listings You Can&apos;t Read</h2>
        <p>The C-grade bucket — 39.4% of all listings — is where careers go to die quietly.</p>
        <p>
          These aren&apos;t fake jobs. The company probably does want to hire someone. But the listing gives you
          almost nothing to work with:
        </p>
        <ul>
          <li>
            <strong>No salary.</strong> Is this a $90K role or a $180K role? You&apos;ll find out after two weeks of
            interviewing.
          </li>
          <li>
            <strong>Vague description.</strong> &quot;Fast-paced environment, wear many hats, passionate
            self-starter.&quot; What does this person actually do all day?
          </li>
          <li>
            <strong>Stale date.</strong> Posted 3 months ago, still live. Is the hiring manager actively reviewing
            resumes, or did they forget to close the req?
          </li>
          <li>
            <strong>No department, no team, no hiring manager.</strong> You&apos;re applying into a void.
          </li>
        </ul>
        <p>
          None of these are &quot;ghost jobs.&quot; All of them waste your time. The question isn&apos;t &quot;is
          this job real?&quot; It&apos;s &quot;is this job worth my time?&quot; That&apos;s a harder question, and
          it requires more data than &quot;real or fake.&quot;
        </p>

        <h2>What Separates Good Listings From Bad Ones</h2>

        <h3>Salary transparency is the #1 signal</h3>
        <div className="not-prose my-6 overflow-x-auto">
          <table className={RTABLE.table}>
            <thead>
              <tr>
                <th className={RTABLE.th}></th>
                <th className={RTABLE.thNum}>Jobs</th>
                <th className={RTABLE.thNum}>Avg Quality Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={RTABLE.td}>Salary posted</td>
                <td className={RTABLE.tdNum}>12,970</td>
                <td className={RTABLE.tdNum}>0.677</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>No salary</td>
                <td className={RTABLE.tdNum}>25,839</td>
                <td className={RTABLE.tdNum}>0.598</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Listings with salary information score 24.5% better across every quality dimension. Only 33% of listings
          include any salary data — two-thirds of the market is opaque by default.
        </p>

        <h3>40% of listings are stale</h3>
        <p>
          Of the 30,980 listings with posted dates, 12,497 (40.3%) have been live for over 60 days without being
          updated.
        </p>

        <h3>Remote jobs are higher quality</h3>
        <div className="not-prose my-6 overflow-x-auto">
          <table className={RTABLE.table}>
            <thead>
              <tr>
                <th className={RTABLE.th}></th>
                <th className={RTABLE.thNum}>Jobs</th>
                <th className={RTABLE.thNum}>Avg Quality Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={RTABLE.td}>Remote</td>
                <td className={RTABLE.tdNum}>3,940</td>
                <td className={RTABLE.tdNum}>0.678</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>Non-remote</td>
                <td className={RTABLE.tdNum}>34,869</td>
                <td className={RTABLE.tdNum}>0.619</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Remote listings score 15.5% higher than non-remote ones — when you compete for talent nationally, you
          can&apos;t rely on proximity, so you have to sell the role on paper.
        </p>

        <h3>Bigger companies post better listings</h3>
        <div className="not-prose my-6 overflow-x-auto">
          <table className={RTABLE.table}>
            <thead>
              <tr>
                <th className={RTABLE.th}>Company size</th>
                <th className={RTABLE.thNum}>Companies</th>
                <th className={RTABLE.thNum}>Jobs</th>
                <th className={RTABLE.thNum}>Avg Quality Score</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={RTABLE.td}>50+ open roles</td>
                <td className={RTABLE.tdNum}>211</td>
                <td className={RTABLE.tdNum}>16,366</td>
                <td className={RTABLE.tdNum}>0.651</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>10–49 roles</td>
                <td className={RTABLE.tdNum}>747</td>
                <td className={RTABLE.tdNum}>15,931</td>
                <td className={RTABLE.tdNum}>0.621</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>&lt; 10 roles</td>
                <td className={RTABLE.tdNum}>2,170</td>
                <td className={RTABLE.tdNum}>6,512</td>
                <td className={RTABLE.tdNum}>0.568</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>Companies with 50+ open positions post 19% better listings than those with fewer than 10.</p>

        <h2>Why &quot;Ghost Job Detector&quot; Is the Wrong Product</h2>
        <p>
          The ghost job framing asks a binary question: real or fake? But the data shows that&apos;s not the useful
          question. Only 6% of listings are clearly fake. The other 94% exist on a spectrum from excellent to
          opaque. What actually matters is the signal density of a listing — how much information it gives you to
          make a decision.
        </p>

        <h2>What To Do With This</h2>
        <p>
          If you&apos;re a job seeker: stop asking &quot;is this job real?&quot; Start asking &quot;does this
          listing tell me enough to decide?&quot; Look for salary, check the posted date, read the description with
          skepticism.
        </p>
        <p>
          If you&apos;re a recruiter: the 39% ambiguous bucket is where you lose commission time — a role that looks
          real but takes 6 months to close is worse than a ghost job, because you invested before you found out.
        </p>
        <p>
          If you&apos;re an employer: two-thirds of your postings don&apos;t include salary, and 40% haven&apos;t
          been refreshed in two months. You&apos;re not posting ghost jobs — you&apos;re posting lazy ones.
        </p>

        <h2>How the screening works</h2>
        <p>
          Every listing gets one of four states below. Like everything else on this page, these are automated
          estimates, not verdicts — see our <Link href="/terms">terms</Link> for how we frame ghost-job and risk
          signals.
        </p>
        <ul>
          <li>
            <strong>No ghost signals</strong> — no ghost-risk signals, the posting looks active.
          </li>
          <li>
            <strong>Worth verifying</strong> — some signals suggest a quick sanity-check before you apply.
          </li>
          <li>
            <strong>Possible ghost job</strong> — signals flag this posting as a possible ghost job: it may be
            stale, evergreen, or not actively hiring, worth verifying before you invest time.
          </li>
          <li>
            <strong>No badge shown yet</strong> — not enough signal gathered.
          </li>
        </ul>
        <p>
          This page is a static July 2026 snapshot. For live, market-wide numbers, see{" "}
          <Link href="/trends">market trends</Link>.
        </p>
        <div className="not-prose mt-6 flex items-center gap-2.5 text-[13px] text-muted-foreground">
          <span className="h-[9px] w-[9px] bg-brand" aria-hidden />
          data · the Subspace jobs corpus
        </div>
      </article>
    </main>
  );
}
