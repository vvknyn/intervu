import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { ELUTA_ALTERNATIVE, ELUTA_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { PUBLIC_ANTI_SCORE_SENTENCE } from "@/lib/marketing/public-copy";

const { title: TITLE, description: DESCRIPTION, path: PATH } = ELUTA_ALTERNATIVE;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(ELUTA_ALTERNATIVE_FAQ);

const ASEC = "mt-8 mb-3 text-xs font-semibold text-muted-foreground";

export default function ElutaAlternativePage() {
  return (
    <main data-testid="eluta-alternative-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-xs font-semibold text-brand">Eluta alternative</p>
      <h1 className="mt-3 font-display text-display font-semibold text-foreground">
        Eluta crawls the career page. So do we — then we ask if it&apos;s still open.
      </h1>
      <p className="mt-1.5 text-sm italic text-muted-foreground">
        velai reads employer career pages wherever they publish. Eluta stays focused on one regional catalog.
      </p>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
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

        <h2 className={ASEC}>What Eluta gets right</h2>
        <p>
          Eluta&apos;s whole premise is that the employer&apos;s site is the signal. Public boards emphasize
          visibility; big aggregators sell reach. Eluta sits closer to the source. velai agrees with that
          premise — we just add a freshness pass and extend the same crawl when the employer publishes
          roles beyond a single national catalog.
        </p>
      </article>

      <div className="mt-8">
        <BoardComparisonTable board="typical" />
      </div>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <h2 className={ASEC}>When to keep Eluta, when to add velai</h2>
        <p>
          Keep Eluta if you want a familiar employer-site directory in one regional catalog and you are happy
          browsing without a stale-posting flag. Use velai when you want to know whether the role is still on the
          company&apos;s career page, or when your search crosses regions and you do not want a second tool.
        </p>
        <p>
          For live roles read from employer career pages, start at{" "}
          <Link href="/jobs">the live listings</Link>.
        </p>

        <h2 className={ASEC}>Look at the jobs</h2>
        <p>
          Searching is free. {PUBLIC_ANTI_SCORE_SENTENCE}{" "}
          <Link href="/jobs">The live listings are here</Link>. Indeed and LinkedIn are different problems (
          <Link href="/indeed-alternative">Indeed alternative</Link>,{" "}
          <Link href="/linkedin-jobs-alternative">LinkedIn Jobs alternative</Link>).
        </p>
      </article>
    </main>
  );
}
