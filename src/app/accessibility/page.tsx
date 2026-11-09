import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { LegalDocFrame, LegalDocHeader } from "@/components/legal/LegalDocHeader";
import { Prose } from "@/components/ui/prose";
import { DocHeading } from "@/components/ui/on-this-page";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

const TITLE = "Accessibility statement";
const DESCRIPTION =
  "How accessible velai is, the standard we hold it to, what we know is not yet right, and how to tell us when something stops you.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata("/accessibility", TITLE, DESCRIPTION),
};

/** The date the page was last written and the date the checks below were last run. Move both together. */
const LAST_UPDATED = "November 9, 2026";

/**
 * The statement the European Accessibility Act asks a service to publish: the standard, the status, what is not
 * yet accessible, a way to report a problem, and where to turn if the reply is not enough. Everything under "How
 * we check" and "Known gaps" comes from a run of axe-core 4.13 (WCAG 2.0 to 2.2, levels A and AA) on the pages
 * named there on the date above, with a desktop and a phone window; a gap is listed here only because that run
 * found it. Re-run the check and update this page whenever a gap is closed or found, and never claim more here
 * than the run shows (tests/e2e/journeys/accessibility-statement.spec.ts holds the page to its own promises).
 */
export default function AccessibilityPage() {
  return (
    <LegalDocFrame testId="accessibility-page" header={<LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />}>
      <Prose>
        <p>
          Looking for work should not depend on how you see, hear, move or read. velai aims to meet the Web Content
          Accessibility Guidelines (WCAG) 2.2 at level AA, the standard the European Accessibility Act points to through
          EN 301 549. This page says where we are against that, what we know is not yet right, and how to tell us when
          something gets in your way.
        </p>

        <DocHeading>Where we stand</DocHeading>
        <p>
          velai is <strong>partially conformant</strong> with WCAG 2.2 level AA. Most of the site meets it. The gaps we
          know of are listed below. This is our own assessment: no outside auditor has reviewed the site.
        </p>
        <p>
          This statement covers the website at velai.app: job search, the job and company pages, your résumé and
          tracker, account settings, the blog and the help pages. It was last written on {LAST_UPDATED}.
        </p>

        <DocHeading>How we check</DocHeading>
        <ul>
          <li>
            We run the axe-core accessibility checker against WCAG 2.0, 2.1 and 2.2 levels A and AA on twelve main pages
            (job search, pricing, about, the blog, the connect page, privacy, terms, contact, sign-in, the research
            page and one comparison page), in a desktop window and a phone window. Our last run was on {LAST_UPDATED}.
          </li>
          <li>
            A few of the rules are re-run after every release by our regression tests: how the job results list is
            built for screen readers, the tab links in the tracker, and underlined links inside paragraphs on the
            privacy page.
          </li>
          <li>
            Automated checks find only part of what can go wrong. They cannot tell you whether a page makes sense read
            aloud, so this page does not claim a screen-reader review we have not done.
          </li>
        </ul>

        <DocHeading>Known gaps</DocHeading>
        <p>These are the problems our last run found and we have not yet fixed:</p>
        <ul>
          <li>
            <strong>Tab controls on the sign-in page and the connect page.</strong> The selected tab points to a panel
            that is not on the page until you pick it, which some screen readers may announce as a broken reference.
          </li>
          <li>
            <strong>Command boxes on the connect page.</strong> When a command is wider than the screen it scrolls
            sideways, and the box cannot be focused with a keyboard on its own.
          </li>
        </ul>
        <p>
          Content we do not write is outside what we can fix directly. Job listings are shown as the employer
          published them, so their headings, images and formatting are the employer&apos;s. Sign-in steps that are
          hosted by our sign-in provider, and the Cloudflare check on some forms, follow their own accessibility
          practice.
        </p>

        <DocHeading>Tell us when something stops you</DocHeading>
        <p>
          If a page, a button or a form does not work for you, email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground text-link">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>. Tell us the page, what you were trying to do, and the
          device and assistive technology you use if you are happy to say. We read every message, and we will tell you
          what we can fix and what we cannot.
        </p>
        <p>
          If you are not satisfied with our reply, you can raise it with the authority in your country or region that
          handles accessibility or consumer complaints.
        </p>

        <DocHeading>Changes</DocHeading>
        <p>
          We update this page when we fix a gap or find a new one, and change the date at the top when we do. Our{" "}
          <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link> are the other two documents
          that describe how the service works.
        </p>
      </Prose>
    </LegalDocFrame>
  );
}
