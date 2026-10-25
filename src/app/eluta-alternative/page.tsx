import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { ELUTA_ALTERNATIVE, ELUTA_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle, PageLead } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const { title: TITLE, description: DESCRIPTION, path: PATH } = ELUTA_ALTERNATIVE;

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(ELUTA_ALTERNATIVE_FAQ);


export default function ElutaAlternativePage() {
  return (
    <PageContainer measure="reading" data-testid="eluta-alternative-page" className="py-10">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-xs font-semibold text-brand">Eluta alternative</p>
      <PageTitle className="mt-3">
        Eluta crawls the career page. So do we — then we ask if it&apos;s still open.
      </PageTitle>
      <PageLead>
        velai reads employer career pages wherever they publish. Eluta stays focused on one regional catalog.
      </PageLead>

      <Prose className="mt-6">
        <p>
          People who search &quot;Eluta alternative&quot; usually already know the pitch: jobs pulled from
          employer websites, not a pile of reposted ads. Eluta built that catalog around well-known
          employers and their career pages. It is a sensible default if you only care about that catalog.
        </p>
        <p>
          velai is the same class of read — we track what the company still shows on its own hiring site — with
          two differences that matter when a listing goes quiet: we screen for stale postings, and we are not
          limited to one regional index when you also want employers that hire across regions.
        </p>

        <SectionTitle>What Eluta gets right</SectionTitle>
        <p>
          Eluta&apos;s whole premise is that the employer&apos;s site is the signal. Public boards emphasize
          visibility; big aggregators sell reach. Eluta sits closer to the source. velai agrees with that
          premise — we just add a freshness pass and extend the same crawl when the employer publishes
          roles beyond a single national catalog.
        </p>
      </Prose>

      <div className="mt-8">
        <BoardComparisonTable board="typical" />
      </div>

      <Prose className="mt-6">
        <SectionTitle>When to keep Eluta, when to add velai</SectionTitle>
        <p>
          Keep Eluta if you want a familiar employer-site directory in one regional catalog and you are happy
          browsing without a stale-posting flag. Use velai when you want to know whether the role is still on the
          company&apos;s career page, or when your search crosses regions and you do not want a second tool.
        </p>
        <p>
          For live roles read from employer career pages, start at{" "}
          <Link href="/jobs">the live listings</Link>.
        </p>

        <SectionTitle>Look at the jobs</SectionTitle>
        <p>
          Searching is free. {PUBLIC_ANTI_SCORE_SENTENCE}{" "}
          <Link href="/jobs">The live listings are here</Link>. Indeed and LinkedIn are different problems (
          <Link href="/indeed-alternative">Indeed alternative</Link>,{" "}
          <Link href="/linkedin-jobs-alternative">LinkedIn Jobs alternative</Link>).
        </p>
      </Prose>
    </PageContainer>
  );
}
