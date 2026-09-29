import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { GHOST_JOB_TERM } from "@/lib/seo/ghost-job-term";
import { LegalDocHeader } from "@/components/legal/LegalDocHeader";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";
import { Prose } from "@/components/ui/prose";
import { SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";

const TITLE = "Terms of Service";
const DESCRIPTION = "The terms for using velai, including how we frame posting-check and risk signals.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/terms", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "September 29, 2026";

export default function TermsPage() {
  return (
    <PageContainer measure="reading" data-testid="terms-page" className="py-10">
      <div className="rounded-none border border-border bg-card p-6 sm:p-10">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <Prose>
        <p>
          velai is in beta. That means the product is real and working, but still changing — features may shift,
          and we&apos;re actively improving how the service works. By using velai, you agree to the terms below.
        </p>

        <SectionTitle>The service</SectionTitle>
        <p>
          velai helps you search and track job listings, and prepare for interviews. The listings we show are
          collected from employers&apos; own public career pages — we don&apos;t invent listings, and we don&apos;t
          charge employers to be included.
        </p>

        <SectionTitle>Posting-check and risk signals are automated observations, not guarantees</SectionTitle>
        <p>
          Posting-check and risk signals — labels like &quot;Possibly stale&quot; or &quot;Worth verifying&quot;,
          covering what the industry calls &quot;{GHOST_JOB_TERM}s&quot; — come from automated checks of facts we
          observe on an employer&apos;s own careers site: posting age, whether a listing is still published, and
          how it has been reposted over time. They describe what we saw when we checked, not an employer&apos;s
          intent, and a listing can change after we check it. They are not statements of fact beyond those
          observations, and we make no warranty as to their accuracy or completeness. Treat every signal as one
          input, not a verdict, when you decide where to spend your time.
        </p>

        <SectionTitle>Acceptable use</SectionTitle>
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

        <SectionTitle>Data licensing</SectionTitle>
        <p>
          We may license derived signals about job postings and companies to third parties through a Data API: for
          example whether a listing is still published on the employer&apos;s site, how long roles stay open, how a
          company reposts, and applicant activity aggregated across everyone and reduced to statistics that no
          longer identify anyone. That never includes your résumé, your applications, your saved jobs, your account
          details, or anything that identifies you. The acceptable-use rules above still apply: bulk extraction
          outside a Data API agreement remains prohibited.
        </p>

        <SectionTitle>Pricing and the founding offer</SectionTitle>
        <p>
          Everything on velai today is free at the limits shown in the product, including AI features. We may
          offer a paid plan (&quot;Pro&quot;) and a Data API in future. What each includes and costs will be on the{" "}
          <Link href="/pricing">pricing page</Link> before anything is charged, and nothing you use today moves
          behind a paywall without notice on that page and an update to these terms.
        </p>
        <p>
          A founding seat is a one-off payment, made through our payment provider, that entitles the account it was
          bought for to Pro for as long as we offer Pro, from the day Pro opens. It is limited in number, tied to
          one account, and not transferable. Until Pro opens you may request a full refund at any time, for any
          reason, by contacting us from the email address you paid with. Payment processing is handled by our
          payment provider under its own terms; we do not see or store your card details. Reserving a seat before
          checkout opens is free and creates no obligation on either side: it records your place and the address we
          send the checkout link to first.
        </p>

        <SectionTitle>Employers</SectionTitle>
        <p>
          If a listing sourced from your company&apos;s careers site is incorrect, outdated, or you&apos;d like it
          removed, use the <Link href="/contact">contact page</Link> and include the listing URL. We&apos;ll act on
          legitimate requests.
        </p>

        <SectionTitle>Account termination</SectionTitle>
        <p>
          We may suspend or close an account that violates these terms or that we determine, in good faith, is
          being used to abuse the service. You may close your account at any time from{" "}
          <Link href="/settings">account settings</Link> ({ACCOUNT_SELF_SERVE_DELETION_FLOW}). What that action
          removes on our servers — and what it does not (including PostHog analytics and email-only records) — is
          spelled out under Retention &amp; deletion in our{" "}
          <Link href="/privacy">Privacy Policy</Link>. We do not provide a separate bulk download of stored account
          data.
        </p>

        <SectionTitle>Changes</SectionTitle>
        <p>We may update these terms as the product changes. We&apos;ll update the date at the top of this page when we do.</p>

        <SectionTitle>Contact</SectionTitle>
        <p>
          Questions: email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>
      </Prose>
      </div>
    </PageContainer>
  );
}
