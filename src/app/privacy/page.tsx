import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { LegalDocFrame, LegalDocHeader } from "@/components/legal/LegalDocHeader";
import { Prose } from "@/components/ui/prose";
import { SubTitle } from "@/components/ui/heading";
import { DocHeading } from "@/components/ui/on-this-page";
import { TELEMETRY_LEDGER_FIELDS_DISCLOSED } from "@/lib/telemetry/public-disclosure";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";
import { PrivacyPromises } from "@/components/legal/PrivacyPromises";
import { COOKIES_DISCLOSED } from "@/lib/legal/cookies-disclosed";
import { PROCESSORS } from "@/lib/legal/processors";
import { LOG_ATTR_ALLOW_LIST } from "@/lib/observability/posthog-logs";
import { PRIVACY_RESUME_SECTION_ID } from "@/lib/legal/privacy-promises";
import { PRO_MONTHLY_PRICE } from "@/app/pricing/offer";

export { TELEMETRY_LEDGER_FIELDS_DISCLOSED };

const TITLE = "Privacy Policy";
const DESCRIPTION = "How Velai keeps your résumé private: read in your browser, encrypted when saved, and never sold. What we collect, why, and how you control it.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  ...canonicalMetadata("/privacy", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "October 30, 2026";

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
    <LegalDocFrame testId="privacy-page" header={<LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />}>

        <PrivacyPromises heading="Velai's privacy promises" showPolicyLink={false} className="mb-8" />

        <Prose>
        <p>
          Velai is a job search tool, and keeping your résumé private is part of what it is. This page explains
          what we collect, why, and how you can control it. If anything here is unclear, use the contact page — we
          read every message ourselves.
        </p>

        <DocHeading id={PRIVACY_RESUME_SECTION_ID}>Your résumé</DocHeading>
        <p>
          Velai reads your résumé file in your browser, on your own device. The file itself is never uploaded to
          us: what Velai works with is the text and the structured résumé read from it.
        </p>
        <p>
          Without a paid month, Velai does not save that structured résumé or send it to its servers: it is kept in
          this browser&apos;s local storage, signed in or not. With a paid month, it is saved to your account so it follows you across devices, and it
          is encrypted with AES-256 before it is stored, under a key kept on our web server rather than in the
          database. The same goes for the copies Velai keeps for you: earlier versions saved in the résumé editor,
          the résumé a role kept when you marked it applied, and tailored résumés filed on a role.
        </p>
        <p>
          Besides you, only an AI assistant or the Velai browser extension that you connect yourself can load your
          saved résumé, and only with a paid month. Velai never sends it to an employer: you apply on the employer&apos;s own site. No AI model on
          our servers reads it. When AI helps read or tailor it, your name and contact details are taken out first
          and the request goes, encrypted, to a sealed server that we can&apos;t read (see{" "}
          <a href="#ai-processing">AI processing</a>).
        </p>
        <p>
          To find jobs that fit, Velai sends role titles taken from your résumé, plus a country and seniority
          filter, to our search index. Those searches are not logged. Strong, Good and Stretch are worked out in
          your browser. The one exception is daily picks, a paid feature you turn on yourself: then our server ranks your saved
          résumé against the week&apos;s roles once a day, by the same rules and with no AI, to choose what it
          emails you (see <a href="#email">Email</a>).
        </p>
        <p>
          Our analytics never record your résumé. Recordings of a visit hide every word and field, there is no
          automatic click capture, and page addresses lose the role titles that ranking by fit puts in them (see <a href="#cookies-analytics">Cookies &amp; analytics</a>).
        </p>
        <p>
          You can delete your résumé from <Link href="/settings">account settings</Link> at any time. That also
          removes its earlier versions and the copies kept on roles you marked applied. Deleting your account
          removes everything, tailored résumés included.
        </p>

        <DocHeading>What we collect</DocHeading>
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
          held in Google Cloud Firestore; it has been moved here, and the copy in Firestore was deleted in October 2026.
        </p>
        <p>
          We keep an anonymous record of the searches people run: the words typed, the place and filters, how
          many jobs came back, and which result was opened. It holds no account id, IP address or browser id, so a
          search can&apos;t be traced back to you, and it is how we learn what people look for and which jobs and
          employers we&apos;re missing. It is encrypted the same way as account data and deleted after 90 days.
          Searches Velai builds from your résumé (ranking by fit, and the daily picks) are not recorded. If
          you&apos;re signed in, the jobs you click, open, save, or apply to are tied to your account so we can
          improve your results. Search records made before the move were not copied, and were deleted with the
          rest of Firestore.
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
          use rank-by-fit or similar résumé-backed retrieval, our servers also send a search query derived
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

        <DocHeading>How we use it</DocHeading>
        <p>
          We use your account data to run the product: to show your tracked applications and, with a paid month, keep your résumés and
          prep answers where you left them. We use your search-activity profile for two things: to make your own
          results more relevant the more you use Velai, and, looked at in aggregate across everyone, to understand
          which kinds of job postings people actually apply to so we can improve search for everyone. Job search is
          free. Anything that has our servers or AI handle your résumé costs {PRO_MONTHLY_PRICE} for a month, bought in advance with one payment and no
          renewal, or paid month to month if you choose that and cancel any time; see the <Link href="/pricing">pricing page</Link>. We don&apos;t sell any of this to
          advertisers. Velai never sells or licenses your data to anyone, even aggregated.
        </p>

        <DocHeading id="ai-processing">AI processing</DocHeading>
        <p>
          We read your résumé in your browser first. If that quick read misses something we match on, the
          résumé&apos;s text, with your name, email, phone number and links taken out, goes to an AI model on{" "}
          <a href="https://tinfoil.sh" rel="noopener noreferrer">Tinfoil</a>&apos;s sealed server. When you
          customize your résumé for a job, only the lines that match that job and the job&apos;s matching
          requirements go there, to be rewritten; when you ask the Chrome extension to draft an answer to an
          application question, only that question, the job&apos;s title and employer and the few résumé lines that
          bear on the question go there. Your browser first checks the server&apos;s hardware proof of
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
          Reading a typed search with AI is switched off today. If we turn it on, the words you typed in the search
          box go to OpenRouter, only to models set not to keep what they are sent, and never your résumé. No audio
          is sent anywhere.
        </p>
        <DocHeading>Connected AI clients</DocHeading>
        <p>
          If you pair an AI client with Velai from the <Link href="/connect">connect page</Link> (Claude,
          ChatGPT, Gemini, or another app that speaks MCP), that client can — after you sign in and approve the
          connection — read your tracked applications and your job preferences, and, with a paid month, your saved résumé, and save
          changes back when you tell it to. Anything your AI client reads travels to that provider and is handled
          under <em>their</em> privacy terms, not ours — we can&apos;t control what the provider you chose retains
          or how it uses what it processes. This only ever happens for a client you connected yourself, and you
          can disconnect it at any time from <Link href="/settings">account settings</Link>, which cuts off all
          further access.
        </p>

        <DocHeading id="browser-extension">Browser extension</DocHeading>
        <p>
          The Velai extension for Chrome reads a job page in two ways. On the job sites it names when you install it
          (job boards and applicant-tracking sites such as LinkedIn, Indeed, Greenhouse, Lever and Workday), and on
          any other site you turn its card on for, it reads each page you open there as it loads, to show a small
          card with your fit and what&apos;s known about the job. Pages that aren&apos;t jobs get no card. Anywhere
          else, it reads a page only when you click its button, or when you pick &ldquo;Search Velai for&rdquo; on
          text you selected. It reads the page&apos;s address, title and the job details the page publishes, plus its
          visible text if you ask it to read the page as the job, or when the page publishes no job details but
          reads as a job (a heading, an Apply button and a job description). It doesn&apos;t keep a list of pages
          you visit. Chrome asks you before the card is turned on anywhere else: for one site, or once for every
          site. On a site you turned it on for, the card checks each page inside your browser and tells Velai
          nothing about pages that aren&apos;t jobs.
        </p>
        <p>
          If you&apos;re signed in to Velai in that browser with a paid month, the extension loads the résumé and job
          preferences saved on your account, then works out your fit and proposes changes to your résumé for the job
          inside the extension. It holds that résumé in memory only, never in Chrome&apos;s storage, and loads it again
          after a minute. Without a paid month, or without signing in, it uses the résumé velai.app keeps in your
          browser instead: on velai.app&apos;s own pages it reads that one stored copy and keeps the same copy in
          Chrome&apos;s storage on your computer, replaced when you change it on velai.app and removed when you remove
          it there. That copy never leaves your computer. Either way, each change is shown beside your own text, and
          nothing changes until you accept it. Your résumé
          with the changes you accepted stays in your browser until you download or copy it. To check the job, the extension sends the role&apos;s
          title and employer to Velai&apos;s search. A search you start with the extension&apos;s button or a text
          selection is logged like any search on the website; the card&apos;s own check when a job page loads is
          not logged. The extension keeps the job it is showing and, for two hours, the job page you last opened
          in each tab (so an application form on a later page knows which job it&apos;s for), which Chrome clears
          when you close the browser, the sites you turned its card off on, and, for each job whose proposed changes
          you accepted or rejected, which ones, as short codes with none of your résumé&apos;s text, for up to 60 days.
        </p>
        <p>
          On an application form, when you pick &ldquo;Fill from your résumé&rdquo;, the extension types the name,
          email, phone, location and links from your Velai résumé into the form&apos;s empty fields that ask for them,
          and attaches your résumé as a PDF with the changes you accepted for that job (none, if you haven&apos;t
          accepted any). That happens in your browser and sends Velai nothing.
          The site gets those details only when you send the form yourself; the extension never sends it. If
          you&apos;re signed in, after it fills a form it watches that tab for the site&apos;s confirmation that your
          application was sent, and then adds the job to your tracker as &ldquo;I applied&rdquo; does.
        </p>
        <p>
          On an application form the extension also lists the free-text questions it finds, such as
          &ldquo;Why are you interested in this role?&rdquo;. It drafts an answer only when you pick &ldquo;Draft an
          answer&rdquo; on one question, and never for questions that are yours to answer: work authorization, pay,
          demographics, start date, relocation, background checks, consents, where you heard about the job. Velai
          picks the few lines of your résumé that bear on that question, without your name, email, phone number or
          links, and sends those lines, the question and the job&apos;s title and employer to an AI model on Tinfoil&apos;s
          sealed server, which the extension first checks and encrypts the request to, so our servers pass it on
          without being able to read it. Sealed AI is part of a paid month. Without one, or if sealed AI isn&apos;t
          available or its server can&apos;t be verified, nothing is sent and the draft is those lines as your résumé
          has them. A draft is marked as a draft from your résumé and goes into the
          form only when you pick &ldquo;Insert in the form&rdquo;; the extension keeps no copy of it and never sends
          the form.
        </p>
        <p>
          When you pick &ldquo;I applied&rdquo;, the extension adds the job (its title, employer and the page&apos;s
          address) to the tracker on your Velai account, the same as &ldquo;Mark as applied&rdquo; on velai.app.
          Signing in and editing your résumé happen on velai.app itself, in a small window the extension opens.
        </p>

        <DocHeading id="email">Email</DocHeading>
        <p>
          We send email through Resend, a transactional email provider, which processes your address and message
          content on our behalf under its own processor terms. Beyond your address itself, we store which kind of
          email you&apos;ve been sent (a waitlist confirmation, the weekly digest, a product update) and its delivery
          status (sent, bounced, or marked as spam) — not the content of what we send you.
        </p>
        <p>
          Daily picks are off until you turn them on, and need a paid month. When they&apos;re on, our server reads the résumé saved on your
          account once a day, ranks the roles posted that week by the same rules as the list on the jobs page that ranks by fit (no AI), and emails you up
          to five. So no role is sent twice, we keep which roles we&apos;ve sent you and when, encrypted with the rest
          of your account and erased with it.
        </p>
        <p>
          If you have an account, we may also email you now and then about changes to Velai, such as a new feature
          or a fix to something that wasn&apos;t working.
        </p>
        <p>
          Every email that isn&apos;t a direct response to something you just did — the weekly digest, daily picks, a
          waitlist confirmation, a product update — includes an unsubscribe link that works without signing in and takes effect immediately.
          If an email to your address bounces, or you mark one as spam, we stop sending to that address
          automatically. You can also turn the weekly digest and daily picks on or off directly from{" "}
          <Link href="/settings">account settings</Link>.
        </p>

        <DocHeading>Behavioural analytics ledger</DocHeading>
        <p>
          Alongside PostHog (below), we keep a separate behavioural ledger in a PostgreSQL database we run. Your
          browser batches product events to our telemetry API — the same catalogue of actions we use to understand
          search and apply funnels. Each row can include: {TELEMETRY_LEDGER_FIELDS_DISCLOSED.join(", ")}. The{" "}
          <code className="text-xs text-foreground">props</code> field holds event-specific metadata (for example query length or
          filter counts — not the full text of what you typed). When you&apos;re signed in, our server stamps your
          user id on each row; guests send only session and visitor ids generated in the browser. We use this
          ledger to improve search quality and to compute aggregate statistics. The ledger lives on Velai&apos;s own
          server, so these events are tied to your account id there. They are never sent to a third party, they
          are deleted after 90 days, and they are deleted with your account.
        </p>

        <DocHeading id="cookies-analytics">Cookies &amp; analytics</DocHeading>
        <p>
          Velai sets the cookies below and no others. None is an advertising or tracking cookie, and none is shared
          with another company.
        </p>
        <ul>
          {COOKIES_DISCLOSED.map((cookie) => (
            <li key={cookie.name}>
              <code className="text-xs text-foreground">{cookie.name}</code> — {cookie.purpose} <em>Lasts: {cookie.lifetime}.</em>
            </li>
          ))}
        </ul>
        <p>
          We use PostHog for anonymous product analytics — page views and a short list of named actions, such as
          opening a job or running a search — so we can see what&apos;s working and fix what isn&apos;t. Velai&apos;s
          events go to the same PostHog project as Subspace (thesubspace.io), the founder&apos;s other product,
          and are told apart by a product tag. The settings described on this page (every word and field hidden
          in recordings, no automatic click capture, no surveys, no profiles, no IP address) are enforced by Velai&apos;s own code
          and our server, not by a PostHog project setting, so they hold whatever that project&apos;s settings say. PostHog&apos;s US cloud (
          <code className="text-xs text-foreground">us.posthog.com</code>, configured as our analytics UI host) processes the data
          as our processor under their own DPA terms. Browser requests are sent through our own{" "}
          <code className="text-xs text-foreground">/ph</code> proxy path rather than directly to third-party analytics domains.
        </p>
        <p>
          PostHog runs cookieless on Velai: no analytics cookie is set. What PostHog needs to hold on to lives in
          your browser&apos;s per-tab storage, so a reload doesn&apos;t restart your session, nothing is shared
          with your other tabs, and all of it is discarded when you close the tab. PostHog events are not linked
          to your Velai account, whether or not you&apos;re signed in: we no longer tell PostHog who you are, and it
          creates no profile of you. Events recorded up to 23 October 2026 were linked to the account of a
          signed-in visitor; deleting your account erases those too. Your IP address is removed by our server before an event is forwarded to PostHog, and so are your cookies and the page you came from (the referrer), so none of them is stored with the events. Tags in a link address (like utm_source or an ad click id) are not kept either: they are removed in your browser before an event is sent. We don&apos;t run ad trackers or any third-party tracking pixels, and beyond
          the cookies listed above Velai sets none. The Cloudflare Turnstile check on the Velai forms that show it
          runs in its own frame and may use its own storage under Cloudflare&apos;s terms to tell humans from
          bots.
        </p>
        <p>
          Separately from product analytics, our servers send error and slow-request logs to PostHog (its logs
          product, US cloud). Each record is a short fixed sentence plus only these fields, enforced in code before
          anything leaves our server:{" "}
          {LOG_ATTR_ALLOW_LIST.map((field, i) => (
            <span key={field}>
              {i > 0 ? ", " : ""}
              <code className="text-xs text-foreground">{field}</code>
            </span>
          ))}
          . These are outcome codes, timings, counts, the route pattern (like{" "}
          <code className="text-xs text-foreground">/unsubscribe/[token]</code>, never the real address), the error
          class and a company&apos;s public web domain. They never include your account id, email address, IP
          address, browser details, the query part of an address, what you searched for, or anything from your
          résumé, and a value that looks like free text or an address is dropped.
        </p>
        <p>
          We record visits for session replay, with every word and field hidden. Before anything leaves your
          browser, it replaces every letter and number on the page, and everything you type, with a star, so a
          recording shows the shape of the page, how far you scrolled and where the pointer moved and clicked,
          and never your résumé, a search, your name or your email address. Page and link addresses lose their
          query string and anything after a #, and console messages and the contents of network requests are not
          recorded. A recording carries the same random code as the events above, which lasts only for that
          browser tab, not your account, and the PostHog project keeps it for 30 days. There is no automatic
          click capture. Events are sent only for the named actions described above, and none of them
          carries the words you typed, your résumé, your name or your email address.
        </p>
        <p>
          Every analytics event carries the address of the page it happened on, with its query string and anything after a # removed before it leaves your browser, so neither the words you searched nor a sign-in link&apos;s token travels with it.
        </p>
        <p>
          PostHog&apos;s survey feature is turned off on Velai, so no survey ever asks for your email address or
          any free text through PostHog. PostHog also does not collect browser error reports.
        </p>

        <DocHeading id="processors">Who handles your data</DocHeading>
        <p>
          These are the outside services that touch your data, and what each one gets. Free job search needs no
          account. Anything that reads your résumé on a server is paid.
        </p>
        <div className="space-y-6">
          {PROCESSORS.map((p) => (
            <section key={p.name}>
              <SubTitle>{p.name}</SubTitle>
              <p><span className="font-semibold text-foreground">What it receives. </span>{p.receives}</p>
              <p><span className="font-semibold text-foreground">Why. </span>{p.why}</p>
              <p><span className="font-semibold text-foreground">Retention. </span>{p.retention}</p>
            </section>
          ))}
        </div>

        <DocHeading>Where data is processed</DocHeading>
        <p>
          You may be in one country while our providers and infrastructure operate elsewhere. We have not verified
          or published a single home region for every data store behind Velai. PostHog product analytics are
          processed in the United States — our app is configured to use PostHog&apos;s US cloud (
          <code className="text-xs text-foreground">us.posthog.com</code>). Other processing — including the databases we
          operate, which hold your account data, search indexes, email delivery, and sign-in through WorkOS — may
          run outside your country, including in the United States, without us naming a region we have not
          confirmed in configuration.
        </p>

        <DocHeading>Retention &amp; deletion</DocHeading>
        <p>
          We keep your account data for as long as your account is active. Search-activity records —
          which searches, which clicks, which applies — are kept for 90 days and then deleted; after that we keep
          only aggregate statistics that no longer identify you. The behavioural analytics ledger described above
          follows the same 90-day deletion window.
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
          it also removes contact-form messages and connect and other waitlist entries stored
          under that address. It deletes the behavioural-ledger rows in PostgreSQL stamped with your account id,
          deletes your customer record at Stripe (with the saved cards and subscriptions on it), erases the
          copy of your account data held in our second database (Firestore or PostgreSQL, whichever is not the
          primary), asks PostHog to delete the person tied to your account id along with that person&apos;s analytics events
          and session recordings, deletes any sign-in record left in Google&apos;s Firebase Authentication from
          before we moved sign-in to WorkOS, then deletes your WorkOS sign-in record. Every step is attempted even if another fails, and if one could not be
          completed we tell you which before you leave, so you can ask us to finish it by hand. Last, our
          identity-forget path removes your row from our PostgreSQL identity store by account id, and for a real
          address also by that address, with global email suppression for it.
        </p>
        <p>
          PostHog data from visits where you were never signed in carries no account id, so it is not linked to
          you and is not removed. Events sent after 23 October 2026 are no longer linked to any account; older events from signed-in visits were, and deleting your account erases them. If
          PostHog can&apos;t be reached when you delete your account, the rest of the
          deletion still completes and we tell you, and we do not retry the PostHog request. Session recordings are not linked to your account,
          so deleting it does not remove them; they expire 30 days after they are made, under PostHog&apos;s rules.
          We have not confirmed a fixed retention period for analytics events in PostHog. Deletion does not
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

        <DocHeading>Your choices</DocHeading>
        <p>
          You can edit or delete content you created in the product. To remove your entire account, use the
          self-serve flow in account settings ({ACCOUNT_SELF_SERVE_DELETION_FLOW}). For questions about privacy or
          deletion, email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>

        <DocHeading>Contact</DocHeading>
        <p>
          Questions: email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>
      </Prose>
    </LegalDocFrame>
  );
}
