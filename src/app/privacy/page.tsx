import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { LegalDocHeader } from "@/components/legal/LegalDocHeader";
import { TELEMETRY_LEDGER_FIELDS_DISCLOSED } from "@/lib/telemetry/public-disclosure";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";
import { Prose } from "@/components/ui/prose";
import { SectionTitle } from "@/components/ui/heading";
import { PageContainer } from "@/components/layout/PageContainer";
import { PrivacyPromises } from "@/components/legal/PrivacyPromises";
import { PRIVACY_RESUME_SECTION_ID } from "@/lib/legal/privacy-promises";

export { TELEMETRY_LEDGER_FIELDS_DISCLOSED };

const TITLE = "Privacy Policy";
const DESCRIPTION = "How Velai keeps your résumé private: read in your browser, encrypted when saved, and never sold. What we collect, why, and how you control it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/privacy", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "October 11, 2026";

/**
 * Plain-language Firestore storage categories for /privacy, each tied to the
 * collection ids they cover. User-visible copy renders the labels only; the
 * ids stay here for tests/unit/privacy-claims-match-code.test.ts, which
 * compares `FIRESTORE_COLLECTIONS_DISCLOSED` (derived below) to
 * `liveFirestoreCollections()` (tests/support/firestore-collection-scan.ts) —
 * the UNION of `scanFirestoreCollections()` and every `collection` named in
 * `MIGRATION_MANIFEST`. The scan alone is not enough: it deliberately harvests
 * zero from manifest-bounded call sites like `src/lib/agent/store.ts`, so
 * `agent_codes`, `agent_credentials`, and `agent_record_budgets` were live and
 * undisclosed until the union caught them. That test fails in both directions:
 * a live collection missing from this map, and ids kept after their last writer
 * is gone — this page once said search activity was NOT in Firestore while
 * search-log.ts wrote it there (fixed in 5d03378).
 */
export const FIRESTORE_STORAGE_CATEGORIES: readonly {
  readonly label: string;
  readonly collections: readonly string[];
}[] = [
  {
    label:
      "Your profile, account record, saved searches, and companies you follow",
    collections: ["profiles", "users", "savedSearches", "followedCompanies"],
  },
  {
    label: "Applications you track (with a copy of the résumé on file when you mark one applied), daily apply counters, and jobs you have opened before",
    collections: ["applications", "apply_counters", "job_views"],
  },
  {
    label: "Résumé editor history, tailored résumés, and per-job analyses used for tailoring",
    collections: ["resume_history", "tailored_resumes", "job_analyses"],
  },
  {
    label:
      "Cached interview-prep responses, interview questions and answers we store for your applications, and questions you mark as favorites",
    collections: ["interview_prep_cache", "interview_questions", "favorite_questions"],
  },
  {
    label: "Career stories, citation sources, and product feedback you submit",
    collections: ["stories", "sources", "feedback"],
  },
  {
    label: "Search queries, result clicks and opens, and company-follow funnel steps we log",
    collections: ["search_events", "search_opens", "follow_funnel_events"],
  },
  {
    label:
      "Connected AI client registrations, pairing codes, credentials, and usage budgets",
    collections: [
      "agent_clients",
      "agent_codes",
      "agent_credentials",
      "agent_record_budgets",
    ],
  },
  {
    label: "Weekly digest send state, email suppressions, and welcome-email send records",
    collections: ["email_digest_state", "email_suppressions", "welcome_emails"],
  },
  {
    label:
      "Connect-page and other waitlists plus contact-form messages (often without an account)",
    collections: ["connect_waitlist", "founding_waitlist", "waitlist", "contact_messages"],
  },
  {
    label:
      "App configuration, daily market aggregates, signed-in viewer sessions, and historical credit-grant records",
    collections: ["app_config", "market_stats_daily", "viewer_sessions", "credit_grants"],
  },
];

/** Every Firestore collection id covered by the storage claims on this page. */
export const FIRESTORE_COLLECTIONS_DISCLOSED: readonly string[] =
  FIRESTORE_STORAGE_CATEGORIES.flatMap((category) => category.collections);

export default function PrivacyPage() {
  return (
    <PageContainer measure="reading" data-testid="privacy-page" className="py-10">
      <div className="rounded-none border border-border bg-card p-6 sm:p-10">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <PrivacyPromises heading="Velai's privacy promises" showPolicyLink={false} className="mb-8" />

        <Prose>
        <p>
          Velai is a job search tool, and keeping your résumé private is part of what it is. This page explains
          what we collect, why, and how you can control it. If anything here is unclear, use the contact page — we
          read every message ourselves.
        </p>

        <SectionTitle id={PRIVACY_RESUME_SECTION_ID}>Your résumé</SectionTitle>
        <p>
          Velai reads your résumé file in your browser, on your own device. The file itself is never uploaded to
          us: what Velai works with is the text and the structured résumé read from it.
        </p>
        <p>
          If you aren&apos;t signed in, that structured résumé is kept in this browser&apos;s local storage and
          nowhere else. If you are signed in, it is saved to your account so it follows you across devices, and it
          is encrypted with AES-256 before it is stored, under a key kept on our web server rather than in the
          database. The same goes for the copies Velai keeps for you: earlier versions saved in the résumé editor,
          the résumé a role kept when you marked it applied, and tailored résumés filed on a role.
        </p>
        <p>
          Besides you, only an AI assistant or the Velai browser extension that you connect yourself can load your
          résumé. Velai never sends it to an employer: you apply on the employer&apos;s own site. No AI model on
          our servers reads it. When AI helps read or tailor it, your name and contact details are taken out first
          and the request goes, encrypted, to a sealed server that we can&apos;t read (see{" "}
          <a href="#ai-processing">AI processing</a>).
        </p>
        <p>
          To find jobs that fit, Velai sends role titles taken from your résumé, plus a country and seniority
          filter, to our search index. Those searches are not logged. Strong, Good and Stretch are worked out in
          your browser.
        </p>
        <p>
          Our analytics never record your résumé. Session replays mask every word on the page and anything you
          type, clicks are recorded without the text you clicked, and page addresses lose the role titles that
          ranking by fit puts in them (see <a href="#cookies-analytics">Cookies &amp; analytics</a>).
        </p>
        <p>
          You can delete your résumé from <Link href="/settings">account settings</Link> at any time. That also
          removes its earlier versions and the copies kept on roles you marked applied. Deleting your account
          removes everything, tailored résumés included.
        </p>

        <SectionTitle>What we collect</SectionTitle>
        <p>
          When you create an account, we collect the email address and profile information you provide. You can
          sign in with Google, a passkey, an email code, or a username and password. Google, passkey, and
          email-code sign-in run through WorkOS, our sign-in provider, which holds your account record under its
          own data-processing terms — we never see or store your Google password. Username-and-password sign-in
          is also processed by WorkOS.
        </p>
        <p>
          Once you&apos;re using Velai, we store the things you create: your tracked applications, saved résumés,
          saved searches, and prep answers. This data lives in a PostgreSQL database we run on our own servers.
          Each record is encrypted with AES-256 under a key only we hold before it is stored, so the database holds
          those records only in encrypted form, and so do the backups taken since the move; older backups expire on
          their normal schedule. A few values we have to look records up by, such as a sign-in username or an
          email, are kept as keyed hashes that can be matched but not read back. Your data is only ever accessed by
          our servers — never exposed directly to the browser or to other users. Until October 2026 this data was
          held in Google Cloud Firestore; it has been moved here, and the copy in Firestore is being deleted.
        </p>
        <p>
          We also keep a record of what you do while searching: the searches you run (including the text of what
          you typed), which job postings come up, and which ones you click, open, save, or apply
          to. If you&apos;re signed in, we tie this to your account and build a profile of your search
          activity over time — what you&apos;re looking for, and what you actually respond to. It is stored and
          encrypted the same way as the rest of your account data. Searches Velai builds from your résumé (ranking
          by fit, For you, and Today) are not part of that record. Search records made before the move were not
          copied; they stay in Firestore only until it is emptied.
        </p>
        <p className="text-xs text-muted-foreground">
          For reference, the kinds of account data these storage claims cover include:
        </p>
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {FIRESTORE_STORAGE_CATEGORIES.map((category) => (
            <li key={category.label}>{category.label}</li>
          ))}
        </ul>
        <p>
          If you join a waitlist (for example, &ldquo;tell me when it&apos;s ready&rdquo; on the connect page), we
          store the email address you enter and which product you asked about — nothing else — and use it only to
          send you that one notification. You don&apos;t need an account for this, and you can ask us to remove it
          at any time via the <Link href="/contact">contact page</Link>.
        </p>
        <p>
          {/* signup-gate-exempt: legal policy prose, not a prompt */}If you sign up for weekly search alerts while browsing jobs without an account, we store the email
          address you enter and the search you asked to watch, and use them only to send you new matching roles
          each week until you unsubscribe.
        </p>
        <p>
          When you search, we read your IP address on our servers for two things: to default your job search to your
          country so first results are nearby, and to rate-limit abusive traffic. That country lookup uses a local
          database on our own server — not a third-party geolocation API — and we do not attach your IP to your
          account, your saved searches, or your tracked applications for that purpose. That same country check does
          one more thing: if it places you in the EU or UK, we don&apos;t give your browser a long-lived id that
          would link your search activity across visits — you get one that resets when you close the tab, and we
          don&apos;t currently ask you to opt into anything more. Like nearly every website, our servers keep
          ordinary technical logs that can briefly include request IPs.
        </p>
        <p>
          Job search itself runs against a Meilisearch index we operate. When you run a search, our servers send the
          text you typed and the filter choices you selected to that index so it can return matching listings. If you
          use rank-by-fit, For you, or similar résumé-backed retrieval, our servers also send a search query derived
          from your parsed résumé — for example experience role titles, headline profession, inferred adjacent role
          titles, top skill names, and an experience-level filter from your years of experience — plus a country
          filter inferred from your résumé location when we can. We do not send your full résumé file or raw résumé
          text to Meilisearch, and these résumé-built searches are not logged. Location typeahead and facet pickers
          can send the place text you type to Meilisearch facet search so suggestions match the corpus.
        </p>
        <p>
          Résumé fit labels (Strong / Good / Stretch) are computed from your résumé and each job&apos;s public fields
          on our servers or in your browser after listings are returned — not by sending your résumé to Meilisearch
          or Subspace for scoring.
        </p>
        <p>
          The listings you browse are public information sourced from employers&apos; career pages. Our servers call
          Subspace&apos;s Jobs API (thesubspace.io) to refresh and fill job descriptions — we send job identifiers
          only, not your résumé or search queries. If you report a listing while signed in and reporting is enabled,
          we send Subspace&apos;s flags API the job URL, job title, the report category you chose (mapped to
          Subspace&apos;s schema), any notes you add, and your Velai user id as <code className="text-xs text-foreground">reporter_key</code>.
        </p>
        <p>
          We don&apos;t buy marketing profiles about you from data brokers.
        </p>

        <SectionTitle>How we use it</SectionTitle>
        <p>
          We use your account data to run the product: to show your tracked applications and keep your résumés and
          prep answers where you left them. We use your search-activity profile for two things: to make your own
          results more relevant the more you use Velai, and, looked at in aggregate across everyone, to understand
          which kinds of job postings people actually apply to so we can improve search for everyone. Velai is
          free to use today; if we introduce a paid plan it will be listed on the{" "}
          <Link href="/pricing">pricing page</Link> before anything is charged. We don&apos;t sell any of this to
          advertisers. Derived signals about postings and companies (whether a listing is still live, how long
          roles stay open, applicant activity reduced to aggregate statistics) may be licensed to third parties
          through a Data API; those signals never include your résumé, your applications, your saved jobs, your
          account details, or anything that identifies you.
        </p>

        <SectionTitle id="ai-processing">AI processing</SectionTitle>
        <p>
          We read your résumé in your browser first. If that quick read misses something we match on, the
          résumé&apos;s text, with your name, email, phone number and links taken out, goes to an AI model on{" "}
          <a href="https://tinfoil.sh" rel="noopener noreferrer">Tinfoil</a>&apos;s sealed server. When you
          customize your résumé for a job, only the lines that match that job and the job&apos;s matching
          requirements go there, to be rewritten. Your browser first checks the server&apos;s hardware proof of
          the code it runs, then encrypts the request so that only that server can read it: our servers pass it
          on without being able to read it, and Tinfoil&apos;s staff can&apos;t read it either. We do not keep the original file.
        </p>
        <p>
          If you have an account, we store the structured résumé with that account until you delete the résumé or
          the account. Deleting the account deletes that copy from our database; backups that still hold it, in
          encrypted form, expire on their normal schedule. Deleting the account also asks PostHog to delete the
          analytics events and replays tied to your account.
        </p>
        <p>
          Strong, Good, and Stretch are calculated from your résumé and each job&apos;s public details. On the
          website that calculation runs in your browser. A connected assistant can also ask our servers to calculate
          it from the résumé saved on the account. Finding jobs sends role and skill phrases to our search index,
          not your full résumé.
        </p>
        <p>
          Interview-prep search parsing can send the search text you typed to OpenRouter. Audio transcription can
          send a recording to Groq. Those requests are not your résumé, and no AI model on our servers reads your
          résumé.
        </p>

        <SectionTitle>Connected AI clients</SectionTitle>
        <p>
          If you pair an AI client with Velai from the <Link href="/connect">connect page</Link> (Claude,
          ChatGPT, Gemini, or another app that speaks MCP), that client can — after you sign in and approve the
          connection — read your saved résumé, your tracked applications, and your job preferences, and save
          changes back when you tell it to. Anything your AI client reads travels to that provider and is handled
          under <em>their</em> privacy terms, not ours — we can&apos;t control what the provider you chose retains
          or how it uses what it processes. This only ever happens for a client you connected yourself, and you
          can disconnect it at any time from <Link href="/settings">account settings</Link>, which cuts off all
          further access.
        </p>

        <SectionTitle id="browser-extension">Browser extension</SectionTitle>
        <p>
          The Velai extension for Chrome reads a job page in two ways. On the job sites it names when you install it
          (job boards and applicant-tracking sites such as LinkedIn, Indeed, Greenhouse, Lever and Workday), and on
          any other site you turn its card on for, it reads each page you open there as it loads, to show a small
          card with your fit and what&apos;s known about the job. Pages that aren&apos;t jobs get no card. Anywhere
          else, it reads a page only when you click its button, or when you pick &ldquo;Search Velai for&rdquo; on
          text you selected. It reads the page&apos;s address, title and the job details the page publishes, plus its
          visible text if you ask it to read the page as the job. It doesn&apos;t keep a list of pages you visit.
          Chrome asks you before the card is turned on for another site, one site at a time.
        </p>
        <p>
          If you&apos;re signed in to Velai in that browser, the extension loads the résumé and job preferences saved
          on your account, then works out your fit and tailors your résumé inside the extension. It holds the
          résumé in memory only, never in Chrome&apos;s storage, and loads it again after a minute. The tailored
          copy stays in your browser until you download or copy it. To check the job, the extension sends the role&apos;s
          title and employer to Velai&apos;s search. A search you start with the extension&apos;s button or a text
          selection is logged like any search on the website; the card&apos;s own check when a job page loads is
          not logged. The extension keeps only the job it is showing, which Chrome clears when you close the
          browser, and the sites you turned its card off on.
        </p>
        <p>
          When you pick &ldquo;I applied&rdquo;, the extension adds the job (its title, employer and the page&apos;s
          address) to the tracker on your Velai account, the same as &ldquo;Mark as applied&rdquo; on velai.app.
          Signing in and editing your résumé happen on velai.app itself, in a small window the extension opens.
        </p>

        <SectionTitle>Email</SectionTitle>
        <p>
          We send email through Resend, a transactional email provider, which processes your address and message
          content on our behalf under its own processor terms. Beyond your address itself, we store which kind of
          email you&apos;ve been sent (a waitlist confirmation, the weekly digest, a product update) and its delivery
          status (sent, bounced, or marked as spam) — not the content of what we send you.
        </p>
        <p>
          If you have an account, we may also email you now and then about changes to Velai, such as a new feature
          or a fix to something that wasn&apos;t working.
        </p>
        <p>
          Every email that isn&apos;t a direct response to something you just did — the weekly digest, a waitlist
          confirmation, a product update — includes an unsubscribe link that works without signing in and takes effect immediately.
          If an email to your address bounces, or you mark one as spam, we stop sending to that address
          automatically. You can also turn the weekly digest on or off directly from{" "}
          <Link href="/settings">account settings</Link>.
        </p>

        <SectionTitle>Behavioural analytics ledger</SectionTitle>
        <p>
          Alongside PostHog (below), we keep a separate behavioural ledger in a PostgreSQL database we run. Your
          browser batches product events to our telemetry API — the same catalogue of actions we use to understand
          search and apply funnels. Each row can include: {TELEMETRY_LEDGER_FIELDS_DISCLOSED.join(", ")}. The{" "}
          <code className="text-xs text-foreground">props</code> field holds event-specific metadata (for example query length or
          filter counts — not the full text of what you typed). When you&apos;re signed in, our server stamps your
          user id on each row; guests send only session and visitor ids generated in the browser. We use this
          ledger to improve search quality and to compute aggregate statistics. Rows are deleted after 90 days.
        </p>

        <SectionTitle id="cookies-analytics">Cookies &amp; analytics</SectionTitle>
        <p>
          We use a session cookie to keep you signed in. It&apos;s httpOnly (invisible to page scripts) and
          identifies your session — nothing more. The jobs board sets one more tiny cookie the first time you
          visit: a returning-visitor flag (literally the value 1, with no identifier in it), so the front door
          can skip the first-visit intro next time.
        </p>
        <p>
          We use PostHog for product analytics — page views, clicks, and searches — so we can see what&apos;s
          working and fix what isn&apos;t. Velai shares one PostHog project with thesubspace.io; we tell events
          apart with a product tag in the analytics payload, not a separate project. PostHog&apos;s US cloud (
          <code className="text-xs text-foreground">us.posthog.com</code>, configured as our analytics UI host) processes the data
          as our processor under their own DPA terms. Browser requests are sent through our own{" "}
          <code className="text-xs text-foreground">/ph</code> proxy path rather than directly to third-party analytics domains.
        </p>
        <p>
          PostHog runs cookieless on Velai: no analytics cookie is set. What PostHog needs to hold on to lives in
          your browser&apos;s per-tab storage, so a reload doesn&apos;t restart your session, nothing is shared
          with your other tabs, and all of it is discarded when you close the tab. PostHog events are not linked
          to your Velai account id unless you&apos;re signed in and we identify your session to PostHog — signed-out
          visits still send page and interaction events. At the PostHog project level, IP addresses are stored (
          IP anonymization is off), including for signed-out visitors. We don&apos;t run ad trackers or any third-party tracking pixels, and beyond
          the two cookies above Velai sets none. The Cloudflare Turnstile check on our contact and sign-up forms
          runs in its own frame and may use its own storage under Cloudflare&apos;s terms to tell humans from
          bots.
        </p>
        <p>
          PostHog session replay is enabled. Replays capture the layout of the pages you saw, how you moved through
          them, console logs, and performance data from the session. Every word on the page, labels and tooltips
          included, is masked before it leaves your browser, and links lose their search terms: we can see where
          you clicked and scrolled, not what the page said, so a replay of your résumé shows no résumé.
          Input masking is on too: anything you type is masked — we can see that you filled in a field, not what
          you put in it. Replays never keep what a page sent to or got back from our servers. Replays are kept for 30 days
          in PostHog, then expire under PostHog&apos;s own retention rules. A replay covers a single tab and is
          tied to your identity only if you&apos;re signed in.
        </p>
        <p>
          Clicks are recorded by which button or link you pressed, never the text in it or in its labels. Every
          analytics event carries the address of the page it happened on; when ranking by fit has put role titles
          from your résumé into that address, they are removed before the event leaves your browser.
        </p>
        <p>
          PostHog also powers heatmaps, in-app feedback surveys, and short forms when a search returns no results.
          Surveys may optionally ask for your email address; we use it only to notify you when matching jobs arrive
          or to follow up on feedback. The field is optional, and every survey works without it. On phone-sized
          viewports we disable automatic survey UI so it does not overlap page content.
        </p>

        <SectionTitle>Where data is processed</SectionTitle>
        <p>
          You may be in one country while our providers and infrastructure operate elsewhere. We have not verified
          or published a single home region for every data store behind Velai. PostHog product analytics are
          processed in the United States — our app is configured to use PostHog&apos;s US cloud (
          <code className="text-xs text-foreground">us.posthog.com</code>). Other processing — including the databases we
          operate, which hold your account data, search indexes, email delivery, and sign-in through WorkOS — may
          run outside your country, including in the United States, without us naming a region we have not
          confirmed in configuration.
        </p>

        <SectionTitle>Retention &amp; deletion</SectionTitle>
        <p>
          We keep your account data for as long as your account is active. Search-activity records —
          which searches, which clicks, which applies — are kept for 90 days and then deleted; after that we keep
          only aggregate statistics that no longer identify you. The behavioural analytics ledger described above
          follows the same 90-day deletion window. PostHog session replays are retained for 30 days in PostHog.
        </p>
        <p>
          You can delete your account yourself from{" "}
          <Link href="/settings">account settings</Link> — self-serve, not a support ticket. The flow is:{" "}
          {ACCOUNT_SELF_SERVE_DELETION_FLOW}. When you confirm, this device&apos;s browser clears local storage
          first, then our servers run the deletion; only if that succeeds do we sign you out and clear your session
          cookie.
        </p>
        <p>
          That server action removes your profile and every user-owned collection in our migration manifest (for
          example applications, résumés, saved searches, prep answers, agent credentials, and email digest state
          keyed to your account). When your sign-in email is a real address, not a synthetic username-only address,
          it also removes contact-form messages and connect, founding-seat, and credit-pack waitlist entries stored
          under that address. It deletes the behavioural-ledger rows in PostgreSQL stamped with your account id,
          asks PostHog to delete the person tied to your account id along with that person&apos;s analytics events
          and session recordings, deletes any sign-in record left in Google&apos;s Firebase Authentication from
          before we moved sign-in to WorkOS, then deletes your WorkOS sign-in record. For a real address it then runs our identity-forget path: global email
          suppression for that address and deletion from our PostgreSQL identity store.
        </p>
        <p>
          PostHog data from visits where you were never signed in carries no account id, so it is not linked to
          you and is not removed. If PostHog can&apos;t be reached when you delete your account, the rest of the
          deletion still completes, and we do not retry the PostHog request. Session replay recordings in PostHog
          are kept for 30 days, as described above, then expire under PostHog&apos;s rules.
          We have not confirmed a fixed retention period for ordinary analytics events or heatmap data in PostHog. Deletion does not
          remove contact-form messages or waitlist entries sent from a different email address than the one you
          sign in with. Anonymous search
          logs and aggregate statistics are unaffected. Suppression entries for your address stay in place so we do
          not resume email after you leave.
        </p>
        <p>
          We do not offer a separate bulk export or machine-readable download of your stored account data. If you
          need account-held data removed, use self-serve deletion above or email us for help removing waitlist or
          contact-form records sent from another address.
        </p>

        <SectionTitle>Your choices</SectionTitle>
        <p>
          You can edit or delete content you created in the product. To remove your entire account, use the
          self-serve flow in account settings ({ACCOUNT_SELF_SERVE_DELETION_FLOW}). For questions about privacy or
          deletion, email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>

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
