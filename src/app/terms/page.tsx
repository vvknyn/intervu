import type { Metadata } from "next";
import Link from "next/link";
import { MAX_MONTHS, MIN_MONTHS, PRO_MONTHLY_PRICE, REFUND_DAYS } from "@/app/pricing/offer";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";
import { LegalDocFrame, LegalDocHeader, LegalProse } from "@/components/legal/LegalDocHeader";
import { DocHeading } from "@/components/ui/on-this-page";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";

const TITLE = "Terms of Service";
const DESCRIPTION = "The terms for using velai, including how we frame posting-check and risk signals.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata("/terms", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "September 29, 2026";

export default function TermsPage() {
  return (
    <LegalDocFrame testId="terms-page">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <LegalProse>
        <p>
          velai is in beta. That means the product is real and working, but still changing — features may shift,
          and we&apos;re actively improving how the service works. By using velai, you agree to the terms below.
        </p>

        <DocHeading>The service</DocHeading>
        <p>
          velai helps you search and track job listings, and prepare for interviews. The listings we show are
          collected from employers&apos; own public career pages — we don&apos;t invent listings, and we don&apos;t
          charge employers to be included.
        </p>

        <DocHeading>Posting-check and risk signals are automated observations, not guarantees</DocHeading>
        <p>
          Posting-check and risk signals — labels like &quot;Possibly stale&quot; or &quot;Worth verifying&quot;,
          covering what the industry calls &quot;{GHOST_JOB_TERM}s&quot; — come from automated checks of facts we
          observe on an employer&apos;s own careers site: posting age, whether a listing is still published, and
          how it has been reposted over time. They describe what we saw when we checked, not an employer&apos;s
          intent, and a listing can change after we check it. They are not statements of fact beyond those
          observations, and we make no warranty as to their accuracy or completeness. Treat every signal as one
          input, not a verdict, when you decide where to spend your time.
        </p>

        <DocHeading>Acceptable use</DocHeading>
        <p>You agree not to:</p>
        <ul>
          <li>Scrape, crawl, or systematically extract data from velai</li>
          <li>Attempt to access another user&apos;s account or credentials</li>
          <li>
            Use automated tools to create accounts, bypass rate limits, or access the service in bulk outside the
            normal product experience
          </li>
        </ul>
        <p>We may suspend or terminate accounts that violate these terms, including accounts we reasonably believe are engaged in abuse.</p>

        <DocHeading>Pricing and refunds</DocHeading>
        <p>
          Searching jobs, matching them against a résumé kept on your own device, and the application tracker are
          free. A paid month costs {PRO_MONTHLY_PRICE} and covers the features where Velai&apos;s servers or AI handle your résumé:
          saving it to your account, AI help importing it, tailoring, screening-question answers, the Chrome
          extension&apos;s résumé, agent tools and the daily-picks email. The current list is on the{" "}
          <Link href="/pricing">pricing page</Link>.
        </p>
        <p>
          You buy {MIN_MONTHS} to {MAX_MONTHS} months at a time with a single payment, made through our payment provider. Each month adds
          30 days of access to the account it was bought for. It never renews on its own and there is no trial. You
          may request a full refund within {REFUND_DAYS} days of paying, for any reason, by contacting us from the email
          address you paid with. Payment processing is handled by our payment provider under its own terms; we do
          not see or store your card details. When paid access ends, the free features keep working, and a résumé
          saved to your account is kept for a limited time before it is deleted, as described in the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>

        <DocHeading>Employers</DocHeading>
        <p>
          If a listing sourced from your company&apos;s careers site is incorrect, outdated, or you&apos;d like it
          removed, use the <Link href="/contact">contact page</Link> and include the listing URL. We&apos;ll act on
          legitimate requests.
        </p>

        <DocHeading>Account termination</DocHeading>
        <p>
          We may suspend or close an account that violates these terms or that we determine, in good faith, is
          being used to abuse the service. You may close your account at any time from{" "}
          <Link href="/settings">account settings</Link> ({ACCOUNT_SELF_SERVE_DELETION_FLOW}). What that action
          removes on our servers — and what it does not (including PostHog analytics and email-only records) — is
          spelled out under Retention &amp; deletion in our{" "}
          <Link href="/privacy">Privacy Policy</Link>. We do not provide a separate bulk download of stored account
          data.
        </p>

        <DocHeading>Changes</DocHeading>
        <p>We may update these terms as the product changes. We&apos;ll update the date at the top of this page when we do.</p>

        <DocHeading>Contact</DocHeading>
        <p>
          Questions: email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>
      </LegalProse>
    </LegalDocFrame>
  );
}
