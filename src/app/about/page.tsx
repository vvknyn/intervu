import type { Metadata } from "next";
import Link from "next/link";
import { BoardComparisonTable } from "@/components/marketing/BoardComparisonTable";
import { GHOST_RESEARCH_HREF } from "@/lib/marketing-stats";
import { JOB_SEARCH_FAQ } from "@/lib/faq";
import { blogPostPath } from "@/lib/blog/posts";
import { IS_VELAI_LEGIT } from "@/lib/blog/is-velai-legit";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { Prose } from "@/components/ui/prose";
import { PageTitle, SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const TITLE = "About velai";
const DESCRIPTION = "What velai is, how it works, and where the data comes from.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/about", TITLE, DESCRIPTION),
};

export default function AboutPage() {
  return (
    <PageContainer measure="reading" data-testid="about-page" className="py-10">
      <p className="text-xs font-semibold text-muted-foreground">About velai</p>
      <PageTitle className="mt-3">About velai</PageTitle>
      <p className="mt-1.5 text-base text-muted-foreground">
        An honest layer over the real job market: what&apos;s actually posted, flagged when it looks stale, out of
        the way otherwise.
      </p>

      <Prose className="mt-6">
        <SectionTitle>What velai is</SectionTitle>
        <p>
          The job market runs on information asymmetry. Employers know which roles are actively being filled,
          which listings are stale, and which teams are really hiring. Job seekers don&apos;t — they see a listing
          that looks the same whether it was posted an hour ago or three months ago, whether five people are being
          interviewed or the req quietly died.
        </p>
        <p>
          velai exists to close that gap. We&apos;re an honest layer over the real job market: we show you what&apos;s
          actually posted, flag what looks stale or low-signal, and get out of the way otherwise.
        </p>

        <SectionTitle>How it works</SectionTitle>
        <p>
          We track listings directly from employers&apos; own career pages — not from aggregators, not from resold
          feeds. That matters for two reasons: freshness and provenance. When a company closes a role in its hiring
          system, it disappears from what we show, usually within a day. And because we&apos;re reading the source,
          not a reposted copy, we can tell you when we first saw a listing — not just when it was reposted somewhere
          else.
        </p>
        <p>
          Every listing we show gets screened for the signals that tell you whether it&apos;s worth your time: how
          long it&apos;s been open, whether it&apos;s been updated recently, and whether it looks like the kind of
          listing that quietly goes nowhere. None of this is a guess dressed up as certainty — see our{" "}
          <Link href="/terms">terms</Link> for how we frame these signals — but it&apos;s a lot more than a bare
          listing gives you. Read how we{" "}
          <Link href={GHOST_RESEARCH_HREF}>screen for stale postings</Link>.
        </p>

        <SectionTitle>Compared to Indeed and LinkedIn</SectionTitle>
        <p>
          The full write-ups are separate:{" "}
          <Link href="/indeed-alternative">Indeed alternative</Link>,{" "}
          <Link href="/linkedin-jobs-alternative">LinkedIn Jobs alternative</Link>, and{" "}
          <Link href="/eluta-alternative">Eluta alternative</Link>. Career-page hubs live under{" "}
          <Link href="/careers/company-career-pages">company career pages</Link> and{" "}
          <Link href="/careers/remote-jobs">remote jobs</Link>.
        </p>
      </Prose>

      <div className="mt-4">
        <BoardComparisonTable board="typical" />
      </div>

      <Prose className="mt-6">
        <SectionTitle>Where the data comes from</SectionTitle>
        <p>
          velai runs on the Subspace jobs corpus — an independent hiring-market data engine that monitors
          companies&apos; own career pages. Subspace is the infrastructure; velai is the product built on top of
          it, focused on making that data useful for your job search. Learn more at{" "}
          <a href="https://thesubspace.io" target="_blank" rel="noopener">
            thesubspace.io
          </a>
          .
        </p>

        <SectionTitle>Contact</SectionTitle>
        <p>
          Questions or feedback: use the <Link href="/contact">contact page</Link>. Wondering whether velai is
          legit? Here&apos;s <Link href={blogPostPath(IS_VELAI_LEGIT.slug)}>how to check it yourself</Link>.
        </p>
      </Prose>

      <Prose className="mt-6">
        <SectionTitle>Questions</SectionTitle>
        {JOB_SEARCH_FAQ.map((item) => (
          <details key={item.question} className="mt-3 border-b border-border pb-3 last:border-b-0">
            <summary className="cursor-pointer font-semibold text-foreground">{item.question}</summary>
            <p className="mt-2 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </Prose>
    </PageContainer>
  );
}
