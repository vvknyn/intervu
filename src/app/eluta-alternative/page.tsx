import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { ELUTA_ALTERNATIVE, ELUTA_ALTERNATIVE_FAQ } from "@/lib/seo/alternatives";
import { buildFaqPageJsonLd, serializeJsonLd } from "@/lib/seo/jsonld";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const { title: TITLE, description: DESCRIPTION, path: PATH } = ELUTA_ALTERNATIVE;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  ...canonicalMetadata(PATH, TITLE, DESCRIPTION),
};

const faqJsonLd = buildFaqPageJsonLd(ELUTA_ALTERNATIVE_FAQ);

const ASEC = "mt-8 mb-3 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground";

export default function ElutaAlternativePage() {
  return (
    <main data-testid="eluta-alternative-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
      )}
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">Eluta alternative</p>
      <h1 className="mt-3 font-display text-display font-extrabold text-foreground">
        Eluta crawls the career page. So do we — then we ask if it&apos;s still open.
      </h1>
      <p className="mt-1.5 text-sm italic text-muted-foreground">
        velai reads employer sites in Canada and beyond. Eluta stays Canada-first.
      </p>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <p>
          Canadians who search &quot;Eluta alternative&quot; usually already know the pitch: jobs pulled from
          employer websites, not a pile of reposted ads. Eluta built that catalog around Canada&apos;s Top 100
          Employers and other domestic career pages. It is a sensible default if you only care about Canadian
          companies.
        </p>
        <p>
          velai is the same class of read — we track what the company still shows on its own hiring site — with
          two differences that matter when a listing goes quiet: we screen for stale postings, and we are not
          limited to a Canada-only index when you also want US or global career pages.
        </p>

        <h2 className={ASEC}>What Eluta gets right</h2>
        <p>
          Eluta&apos;s whole premise is that the employer&apos;s site is the signal. Job Bank covers public
          postings; Indeed.ca sells visibility. Eluta sits closer to the source. velai agrees with that
          premise — we just add a freshness pass and extend the same crawl outside Canada when the employer
          publishes there.
        </p>
      </article>

      <div className="mt-8">
        <BoardComparisonTable board="typical" />
      </div>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <h2 className={ASEC}>When to keep Eluta, when to add velai</h2>
        <p>
          Keep Eluta if you want a familiar Canada-only directory and you are happy browsing employer sites
          without a stale-posting flag. Use velai when you want to know whether the role is still on the
          company&apos;s career page, or when your search crosses the border and you do not want a second tool.
        </p>
        <p>
          For city-level Canada hubs — Toronto, Vancouver, Montreal, and others — start at{" "}
          <Link href="/careers/canada-jobs">Canada jobs</Link> or jump straight to{" "}
          <Link href="/jobs?country=Canada">live listings scoped to Canada</Link>.
        </p>

        <h2 className={ASEC}>Look at the jobs</h2>
        <p>
          Searching is free. No match score, no sponsored bump.{" "}
          <Link href="/jobs">The live listings are here</Link>. Indeed and LinkedIn are different problems (
          <Link href="/indeed-alternative">Indeed alternative</Link>,{" "}
          <Link href="/linkedin-jobs-alternative">LinkedIn Jobs alternative</Link>).
        </p>
      </article>
    </main>
  );
}
