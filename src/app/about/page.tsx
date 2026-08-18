import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const TITLE = "About";
const DESCRIPTION = "What intervu is, how it works, and where the data comes from.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/about", TITLE, DESCRIPTION),
};

export default function AboutPage() {
  return (
    <main data-testid="about-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-none border border-border/80 bg-card/75 p-6 sm:p-10 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
        <div className="border-b border-border pb-4 mb-6">
          <span className="text-xs font-bold uppercase tracking-widest text-brand">[ ABOUT INTERVU ]</span>
          <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-tight text-foreground">About The Corpus</h1>
        </div>

        <article className="prose prose-sm max-w-none dark:prose-invert">
        <h2>What intervu is</h2>
        <p>
          The job market runs on information asymmetry. Employers know which roles are actively being filled,
          which listings are stale, and which teams are really hiring. Job seekers don&apos;t — they see a listing
          that looks the same whether it was posted an hour ago or three months ago, whether five people are being
          interviewed or the req quietly died.
        </p>
        <p>
          intervu exists to close that gap. We&apos;re an honest layer over the real job market: we show you what&apos;s
          actually posted, flag what looks stale or low-signal, and get out of the way otherwise.
        </p>

        <h2>How it works</h2>
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
          listing gives you.
        </p>

        <h2>How Intervu compares to Indeed and LinkedIn</h2>
        <p>
          Traditional job boards like Indeed and LinkedIn were built for employer advertising, not candidate clarity.
          Here is how Intervu is different:
        </p>
        <ul>
          <li>
            <strong>Direct ATS indexing vs. aggregator clutter:</strong> Instead of flooded feeds filled with third-party
            reposts and staffing-firm duplicates, Intervu syncs directly with verified company career portals.
          </li>
          <li>
            <strong>Active ghost-job screening:</strong> On Indeed and LinkedIn, stale listings linger indefinitely even
            when hiring has paused. Intervu monitors employer hiring velocity, ATS update timestamps, and posting age to
            protect you from dead-end applications.
          </li>
          <li>
            <strong>Real salary transparency:</strong> We surface explicit compensation ranges and compensation benchmarks
            up front so you don&apos;t spend weeks interviewing blindly.
          </li>
          <li>
            <strong>Zero sponsored spam:</strong> Results are ordered by genuine relevance and freshness — never distorted
            by pay-to-play employer ad budgets.
          </li>
        </ul>


        <h2>Where the data comes from</h2>
        <p>
          intervu runs on the Subspace jobs corpus — an independent hiring-market data engine that monitors
          companies&apos; own career pages. Subspace is the infrastructure; intervu is the product built on top of
          it, focused on making that data useful for your job search. Learn more at{" "}
          <a href="https://thesubspace.io" target="_blank" rel="noopener">
            thesubspace.io
          </a>
          .
        </p>

        <h2>Contact</h2>
        <p>
          Questions or feedback: use the <Link href="/contact">contact page</Link>.
        </p>
      </article>
      </div>
    </main>
  );
}
