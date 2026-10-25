import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { INDEED_ALTERNATIVE, INDEED_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getGhostJobsStats } from "@/lib/research/ghost-jobs-snapshot";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle, PageLead } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const { title: TITLE, description: DESCRIPTION, path: PATH } = INDEED_ALTERNATIVE;

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(INDEED_ALTERNATIVE_FAQ);
const stats = getGhostJobsStats();


export default function IndeedAlternativePage() {
  return (
    <PageContainer measure="reading" data-testid="indeed-alternative-page" className="py-10">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-xs font-semibold text-brand">Indeed alternative</p>
      <PageTitle className="mt-3">
        The listing is still up. That doesn&apos;t mean they&apos;re hiring.
      </PageTitle>
      <PageLead>
        velai reads the career page. Indeed sells the leftover ad.
      </PageLead>

      <Prose className="mt-6">
        <p>
          People type &quot;Indeed alternative&quot; after a stretch of applications that went nowhere. Not because
          they hate the logo. The job they spent a Sunday on was still marked actively hiring, and nobody on the
          other side was in the room.
        </p>
        <p>
          Indeed makes money when a listing stays visible. You pay with time. Those incentives share a search
          result and almost nothing else.
        </p>

        <SectionTitle>What we read instead</SectionTitle>
        <p>
          velai doesn&apos;t take job ads. We read what the company posted on its own career page: Greenhouse,
          Lever, Ashby, Workday, the systems HR actually logs into. When they close the role there, it leaves
          here, usually within a day.
        </p>
      </Prose>

      <div className="mt-8">
        <BoardComparisonTable board="indeed" />
      </div>

      <Prose className="mt-6">
        <SectionTitle>The Sunday you don&apos;t get back</SectionTitle>
        <p>
          A paid listing can outlive the job. That&apos;s the product. The company already bought the slot, so the
          slot stays filled, and the apply button keeps working. You find out it was empty after you&apos;ve
          rewritten the cover letter again.
        </p>
        <p>
          We graded {stats.totalScored.toLocaleString()} listings off those career pages. Of the ones that even
          carried a posted date, {stats.stalenessPct}% had been sitting more than 60 days.{" "}
          <Link href="/research/ghost-jobs">We published the tables</Link> if you want the breakdown.
        </p>
        <p>
          Keep Indeed if you want volume. Use velai when you want to know whether the role is still on the
          company&apos;s own site.
        </p>

        <SectionTitle>Look at the jobs</SectionTitle>
        <p>
          Searching is free.{" "}
          {PUBLIC_ANTI_SCORE_SENTENCE}{" "}
          <Link href="/jobs">The live listings are here</Link>. LinkedIn Jobs is a different mess (
          <Link href="/linkedin-jobs-alternative">no profile, no Easy Apply pile</Link>
          ).
        </p>
      </Prose>
    </PageContainer>
  );
}
