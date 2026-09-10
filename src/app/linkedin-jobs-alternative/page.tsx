import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { LINKEDIN_JOBS_ALTERNATIVE, LINKEDIN_JOBS_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const { title: TITLE, description: DESCRIPTION, path: PATH } = LINKEDIN_JOBS_ALTERNATIVE;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(LINKEDIN_JOBS_ALTERNATIVE_FAQ);

const ASEC = "mt-8 mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground";

export default function LinkedinJobsAlternativePage() {
  return (
    <main data-testid="linkedin-jobs-alternative-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">LinkedIn Jobs alternative</p>
      <h1 className="mt-3 font-display text-display font-extrabold text-foreground">
        Easy Apply is a feeling. It isn&apos;t a reply.
      </h1>
      <p className="mt-1.5 text-sm italic text-muted-foreground">
        velai has no profile to polish and no badge that says you&apos;re a top applicant.
      </p>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
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
      </article>

      <div className="mt-8">
        <BoardComparisonTable board="linkedin" />
      </div>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <h2 className={ASEC}>Stay for the network if you want it</h2>
        <p>
          If LinkedIn is how you hear about people, keep the account. Use velai when you want the jobs without
          the performance. Searching is free.{" "}
          <Link href="/jobs">The live listings are here</Link>.
        </p>
        <p>
          Indeed is a different kind of leftover: paid ads that outlive the role.{" "}
          <Link href="/indeed-alternative">That write-up is separate</Link>.
        </p>
      </article>
    </main>
  );
}
