import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using intervu, including how we frame ghost-job and risk signals.",
};

const LAST_UPDATED = "August 1, 2026";

export default function TermsPage() {
  return (
    <main data-testid="terms-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-display font-extrabold text-foreground">Terms of Service</h1>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <p>Last updated: {LAST_UPDATED}</p>

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

        <h2>Ghost-job and risk signals are estimates, not facts</h2>
        <p>
          Ghost-job and risk signals — labels like &quot;possible ghost job&quot; or &quot;worth verifying&quot; —
          are automated estimates based on posting age, listing freshness, and patterns across an employer&apos;s
          other listings. They are not statements of fact about any specific listing or employer, and we make no
          warranty as to their accuracy. Treat every signal as one input, not a verdict, when you decide where to
          spend your time.
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

        <h2>Credits</h2>
        <p>Some features use credits. Credits are prepaid and non-refundable once used. Credit packs don&apos;t expire.</p>

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
    </main>
  );
}
