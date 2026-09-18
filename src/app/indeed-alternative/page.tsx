import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { INDEED_ALTERNATIVE, INDEED_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { getGhostJobsStats } from "@/lib/research/ghost-jobs-snapshot";

const { title: TITLE, description: DESCRIPTION, path: PATH } = INDEED_ALTERNATIVE;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(INDEED_ALTERNATIVE_FAQ);
const stats = getGhostJobsStats();

const ASEC = "mt-8 mb-3 text-xs font-semibold text-muted-foreground";

export default function IndeedAlternativePage() {
  return (
    <main data-testid="indeed-alternative-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-xs font-semibold text-brand">Indeed alternative</p>
      <h1 className="mt-3 font-display text-display font-semibold text-foreground">
        The listing is still up. That doesn&apos;t mean they&apos;re hiring.
      </h1>
      <p className="mt-1.5 text-sm italic text-muted-foreground">
        velai reads the career page. Indeed sells the leftover ad.
      </p>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <p>
          People type &quot;Indeed alternative&quot; after a stretch of applications that went nowhere. Not because
          they hate the logo. The job they spent a Sunday on was still marked actively hiring, and nobody on the
          other side was in the room.
        </p>
        <p>
          Indeed makes money when a listing stays visible. You pay with time. Those incentives share a search
          result and almost nothing else.
        </p>

        <h2 className={ASEC}>What we read instead</h2>
        <p>
          velai doesn&apos;t take job ads. We read what the company posted on its own career page: Greenhouse,
          Lever, Ashby, Workday, the systems HR actually logs into. When they close the role there, it leaves
          here, usually within a day.
        </p>
      </article>

      <div className="mt-8">
        <BoardComparisonTable board="indeed" />
      </div>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <h2 className={ASEC}>The Sunday you don&apos;t get back</h2>
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

        <h2 className={ASEC}>Look at the jobs</h2>
        <p>
          Searching is free. No percentage telling you you&apos;re a 73% match for a paragraph nobody updated.{" "}
          <Link href="/jobs">The live listings are here</Link>. LinkedIn Jobs is a different mess (
          <Link href="/linkedin-jobs-alternative">no profile, no Easy Apply pile</Link>
          ).
        </p>
      </article>
    </main>
  );
}
