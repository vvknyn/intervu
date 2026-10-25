import type { Metadata } from "next";
import Link from "next/link";
import { buildArticleJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getGhostJobsStats } from "@/lib/research/ghost-jobs-snapshot";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle, SubTitle, PageLead } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const HEADLINE = "Ghost jobs aren't the problem — wasted applications are";
// This article was first published as an essay in July 2026; that authorship
// date is independent of the corpus snapshot below and doesn't move when the
// snapshot is refreshed (see stats.dateModified, which does).
const DATE_PUBLISHED = "2026-07-01";

const stats = getGhostJobsStats();

const DESCRIPTION = `We scored ${stats.totalScored.toLocaleString()} job listings from corporate ATS platforms. ${stats.gradePct.DF}% are outright junk, but nearly half are missing the signals you need to decide if they're worth your time.`;

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata("/research/ghost-jobs", HEADLINE, DESCRIPTION),
};

const articleJsonLd = buildArticleJsonLd({
  headline: HEADLINE,
  datePublished: DATE_PUBLISHED,
  dateModified: stats.dateModified,
  description: DESCRIPTION,
  path: "/research/ghost-jobs",
});

// Squared "rtable" treatment (docs-mockup.html lines 281-284, "THE RULES" #4):
// one hairline border around the whole table, header cells mono/uppercase
// with no top border, every data-row cell gets a top hairline instead of a
// bottom one so hairlines live inside the table, never floating outside it.
// Single source of truth for all three tables on this page.
const RTABLE_TH =
  "px-4 py-3 text-left text-xs font-semibold text-muted-foreground";
const RTABLE_TD = "border-t border-border px-4 py-3";
const RTABLE = {
  table: "w-full border-collapse border border-border text-sm",
  th: RTABLE_TH,
  thNum: `${RTABLE_TH} text-right`,
  td: RTABLE_TD,
  tdMono: `${RTABLE_TD}`,
  tdNum: `${RTABLE_TD} text-right`,
};



export default function GhostJobsResearchPage() {
  return (
    <PageContainer measure="reading" data-testid="research-ghost-jobs-page" className="py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <p className="mono-data text-xs font-semibold text-muted-foreground">
        From our research · Corpus snapshot
      </p>
      <PageTitle className="mt-3">
        Ghost jobs aren&apos;t the problem. Wasted applications are.
      </PageTitle>
      <PageLead>
        We scored {stats.totalScored.toLocaleString()} job listings from corporate ATS platforms.{" "}
        {stats.gradePct.DF}% are outright junk. But nearly half are missing the signals you need to know if
        they&apos;re worth your time.
      </PageLead>
      <p
        data-testid="ghost-jobs-asof"
        className="mono-data mb-6 mt-3 border-b border-border pb-3 text-xs text-muted-foreground"
      >
        snapshot: {stats.asOfLabel} · grading queries re-run on refresh — the numbers update, the argument
        doesn&apos;t have to
      </p>

      <Prose>
        <p>
          The internet is obsessed with ghost jobs. &quot;50% of listings are fake.&quot; &quot;Companies post jobs
          they never intend to fill.&quot; It makes for great rage content.
        </p>
        <p>
          But after scoring {stats.totalScored.toLocaleString()} listings pulled directly from corporate hiring
          systems, we think the ghost job debate is a distraction from the actual problem.
        </p>
        <p>
          Most job listings aren&apos;t fake. They&apos;re just bad. And bad listings waste more of your time than
          fake ones ever could — because you can&apos;t tell the difference until you&apos;re three interviews deep.
        </p>

        <SectionTitle>The real numbers</SectionTitle>
        <p>
          This is a {stats.asOfLabel} snapshot of our scored corpus. We pull listings directly from corporate
          applicant tracking systems — Greenhouse, Ashby, Lever, SmartRecruiters, Workday, and 17 others. Not from
          Indeed. Not from LinkedIn. From the company&apos;s own hiring system.
        </p>
        <p>
          Every listing gets scored on freshness, description quality, salary transparency, employer signals, and
          role substance. Here&apos;s what{" "}
          <span className="verified-underline">{stats.totalScored.toLocaleString()}</span> listings across{" "}
          <span className="verified-underline">{stats.companiesCount.toLocaleString()}</span> companies look like:
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
                <td className={RTABLE.td}>{stats.grades.A.description}</td>
                <td className={RTABLE.tdNum}>{stats.grades.A.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.gradePct.A}%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>B</td>
                <td className={RTABLE.td}>{stats.grades.B.description}</td>
                <td className={RTABLE.tdNum}>{stats.grades.B.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.gradePct.B}%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>C</td>
                <td className={RTABLE.td}>{stats.grades.C.description}</td>
                <td className={RTABLE.tdNum}>{stats.grades.C.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.gradePct.C}%</td>
              </tr>
              <tr>
                <td className={RTABLE.tdMono}>D–F</td>
                <td className={RTABLE.td}>{stats.grades.DF.description}</td>
                <td className={RTABLE.tdNum}>{stats.grades.DF.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.gradePct.DF}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p>
          Only <span className="verified-underline">{stats.gradePct.A}%</span> of listings are excellent. Half are
          good enough. And nearly <span className="verified-underline">{stats.ambiguousOrWorsePct}%</span> are
          either ambiguous or worse.
        </p>
        <p>
          The {stats.gradePct.DF}% that are genuinely low quality? Those are the &quot;ghost jobs&quot; everyone is
          angry about. But they&apos;re the minority of the problem.
        </p>

        <SectionTitle>
          The real problem: {stats.grades.C.count.toLocaleString()} listings you can&apos;t read
        </SectionTitle>
        <p>The C-grade bucket — {stats.gradePct.C}% of all listings — is where careers go to die quietly.</p>
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

        <SectionTitle>What separates good listings from bad ones</SectionTitle>

        <SubTitle>Salary transparency is the #1 signal</SubTitle>
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
                <td className={RTABLE.tdNum}>{stats.salary.posted.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.salary.posted.avgScore.toFixed(3)}</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>No salary</td>
                <td className={RTABLE.tdNum}>{stats.salary.notPosted.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.salary.notPosted.avgScore.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Listings with salary information score {stats.salaryLiftPct}% better across every quality dimension. Only{" "}
          {stats.salaryPostedSharePct}% of listings include any salary data — two-thirds of the market is opaque by
          default.
        </p>

        <SubTitle>{stats.stalenessPct}% of listings are stale</SubTitle>
        <p>
          Of the {stats.staleness.withPostedDate.toLocaleString()} listings with posted dates,{" "}
          {stats.staleness.over60d.toLocaleString()} ({stats.stalenessPct}%) have been live for over 60 days without
          being updated.
        </p>

        <SubTitle>Remote jobs are higher quality</SubTitle>
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
                <td className={RTABLE.tdNum}>{stats.remote.remote.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.remote.remote.avgScore.toFixed(3)}</td>
              </tr>
              <tr>
                <td className={RTABLE.td}>Non-remote</td>
                <td className={RTABLE.tdNum}>{stats.remote.nonRemote.count.toLocaleString()}</td>
                <td className={RTABLE.tdNum}>{stats.remote.nonRemote.avgScore.toFixed(3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Remote listings score {stats.remoteLiftPct}% higher than non-remote ones — when you compete for talent
          nationally, you can&apos;t rely on proximity, so you have to sell the role on paper.
        </p>

        <SubTitle>Bigger companies post better listings</SubTitle>
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
              {stats.companySize.map((bucket) => (
                <tr key={bucket.label}>
                  <td className={RTABLE.td}>{bucket.label}</td>
                  <td className={RTABLE.tdNum}>{bucket.companies.toLocaleString()}</td>
                  <td className={RTABLE.tdNum}>{bucket.jobs.toLocaleString()}</td>
                  <td className={RTABLE.tdNum}>{bucket.avgScore.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Companies with {stats.companySize[0]!.label.toLowerCase()} post {stats.companySizeLiftPct}% better
          listings than those with fewer than 10.
        </p>

        <SectionTitle>Why &quot;ghost job detector&quot; is the wrong product</SectionTitle>
        <p>
          The ghost job framing asks a binary question: real or fake? But the data shows that&apos;s not the useful
          question. Only {stats.gradePct.DF}% of listings are clearly fake. The other{" "}
          {(100 - Number(stats.gradePct.DF)).toFixed(1)}% exist on a spectrum from excellent to opaque. What
          actually matters is the signal density of a listing — how much information it gives you to make a
          decision.
        </p>

        <SectionTitle>What to do with this</SectionTitle>
        <p>
          If you&apos;re a job seeker: stop asking &quot;is this job real?&quot; Start asking &quot;does this
          listing tell me enough to decide?&quot; Look for salary, check the posted date, read the description with
          skepticism.
        </p>
        <p>
          If you&apos;re a recruiter: the {stats.gradePct.C}% ambiguous bucket is where you lose commission time — a
          role that looks real but takes 6 months to close is worse than a ghost job, because you invested before
          you found out.
        </p>
        <p>
          If you&apos;re an employer: two-thirds of your postings don&apos;t include salary, and {stats.stalenessPct}
          % haven&apos;t been refreshed in two months. You&apos;re not posting ghost jobs — you&apos;re posting lazy
          ones.
        </p>

        <SectionTitle>How the screening works</SectionTitle>
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
          This page is a {stats.asOfLabel} snapshot. For live, market-wide numbers, see{" "}
          <Link href="/trends">market trends</Link>.
        </p>
        <div className="not-prose mt-6 flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="h-2 w-2 bg-brand" aria-hidden />
          data · the Subspace jobs corpus
        </div>
      </Prose>
    </PageContainer>
  );
}
