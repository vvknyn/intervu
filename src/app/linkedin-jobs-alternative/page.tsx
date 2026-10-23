import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { LINKEDIN_JOBS_ALTERNATIVE, LINKEDIN_JOBS_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const { title: TITLE, description: DESCRIPTION, path: PATH } = LINKEDIN_JOBS_ALTERNATIVE;

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(LINKEDIN_JOBS_ALTERNATIVE_FAQ);


export default function LinkedinJobsAlternativePage() {
  return (
    <PageContainer measure="reading" data-testid="linkedin-jobs-alternative-page" className="py-10">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-xs font-semibold text-brand">LinkedIn Jobs alternative</p>
      <PageTitle className="mt-3">
        Easy Apply is a feeling. It isn&apos;t a reply.
      </PageTitle>
      <p className="mt-1.5 text-base text-muted-foreground">
        velai has no profile to polish and no badge that says you&apos;re a top applicant.
      </p>

      <Prose className="mt-6">
        <p>
          LinkedIn is good at people you already know. The job tab is a sidecar on a network that makes money
          when you linger. You post an update. You refresh the Open to Work photo. None of that tells you
          whether the req is still real.
        </p>
        <p>
          Easy Apply is the part that hurts. You tap, it fires your profile into a pile, and the listing can be
          a recruiter&apos;s evergreen &quot;let&apos;s see who&apos;s out there.&quot; You did something that
          felt like applying. They collected a lead.
        </p>
        <p>
          velai doesn&apos;t have profiles, banners, or a score for how well you match a paragraph that hasn&apos;t
          been touched in a year. We show what&apos;s on the career page and mark the ones that look stale.
        </p>
      </Prose>

      <div className="mt-8">
        <BoardComparisonTable board="linkedin" />
      </div>

      <Prose className="mt-6">
        <SectionTitle>Stay for the network if you want it</SectionTitle>
        <p>
          If LinkedIn is how you hear about people, keep the account. Use velai when you want the jobs without
          the performance. Searching is free.{" "}
          <Link href="/jobs">The live listings are here</Link>.
        </p>
        <p>
          Indeed is a different kind of leftover: paid ads that outlive the role.{" "}
          <Link href="/indeed-alternative">That write-up is separate</Link>.
        </p>
      </Prose>
    </PageContainer>
  );
}
