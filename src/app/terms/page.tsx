import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";
import { LegalDocHeader } from "@/components/legal/LegalDocHeader";

const TITLE = "Terms of Service";
const DESCRIPTION = "The terms for using intervu, including how we frame posting-check and risk signals.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/terms", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "August 27, 2026";

export default function TermsPage() {
  return (
    <main data-testid="terms-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-none border border-border/80 bg-card/75 p-6 sm:p-10 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <article className="prose prose-sm max-w-none dark:prose-invert">
        <p>
          intervu is in beta. That means the product is real and working, but still changing — features may shift,
          and we&apos;re actively improving how the service works. By using intervu, you agree to the terms below.
        </p>

        <h2>The service</h2>
        <p>
          intervu helps you search and track job listings, and prepare for interviews. The listings we show are
          collected from employers&apos; own public career pages — we don&apos;t invent listings, and we don&apos;t
          charge employers to be included.
        </p>

        <h2>Posting-check and risk signals are automated observations, not guarantees</h2>
        <p>
          Posting-check and risk signals — labels like &quot;Possibly stale&quot; or &quot;Worth verifying&quot;,
          covering what the industry calls &quot;{GHOST_JOB_TERM}s&quot; — come from automated checks of facts we
          observe on an employer&apos;s own careers site: posting age, whether a listing is still published, and
          how it has been reposted over time. They describe what we saw when we checked, not an employer&apos;s
          intent, and a listing can change after we check it. They are not statements of fact beyond those
          observations, and we make no warranty as to their accuracy or completeness. Treat every signal as one
          input, not a verdict, when you decide where to spend your time.
        </p>

        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Scrape, crawl, or systematically extract data from intervu</li>
          <li>Attempt to access another user&apos;s account or credentials</li>
          <li>
            Use automated tools to create accounts, bypass rate limits, or access the service in bulk outside the
            normal product experience
          </li>
        </ul>
        <p>We may suspend or terminate accounts that violate these terms, including accounts we reasonably believe are engaged in abuse.</p>

        <h2>AI features</h2>
        <p>AI features are free. Nothing is metered and there is nothing to buy.</p>

        <h2>Employers</h2>
        <p>
          If a listing sourced from your company&apos;s careers site is incorrect, outdated, or you&apos;d like it
          removed, use the <Link href="/contact">contact page</Link> and include the listing URL. We&apos;ll act on
          legitimate requests.
        </p>

        <h2>Account termination</h2>
        <p>
          We may suspend or close an account that violates these terms or that we determine, in good faith, is
          being used to abuse the service. You may close your account at any time from account settings.
        </p>

        <h2>Changes</h2>
        <p>We may update these terms as the product changes. We&apos;ll update the date at the top of this page when we do.</p>

        <h2>Contact</h2>
        <p>
          Questions: use the <Link href="/contact">contact page</Link>.
        </p>
      </article>
      </div>
    </main>
  );
}
