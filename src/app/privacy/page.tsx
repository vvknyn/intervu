import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { LegalDocHeader, LEGAL_H2 } from "@/components/legal/LegalDocHeader";
import { TELEMETRY_LEDGER_FIELDS_DISCLOSED } from "@/lib/telemetry/public-disclosure";
import {
  ACCOUNT_SELF_SERVE_DELETION_FLOW,
  PUBLIC_SUPPORT_EMAIL,
} from "@/lib/legal/public-contact";

export { TELEMETRY_LEDGER_FIELDS_DISCLOSED };

const TITLE = "Privacy Policy";
const DESCRIPTION = "How velai collects, uses, and protects your data.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/privacy", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "September 26, 2026";

/**
 * Every Firestore collection the storage claims on this page cover today.
 * Rendered below rather than hand-typed into the prose, and checked by
 * tests/unit/privacy-claims-match-code.test.ts against
 * `liveFirestoreCollections()` (tests/support/firestore-collection-scan.ts),
 * which is the UNION of `scanFirestoreCollections()` (every collection
 * referenced by a literal in src/) and every `collection` named in
 * `MIGRATION_MANIFEST`. The scan alone is not enough: it deliberately
 * harvests zero from files that resolve their collection name through the
 * manifest at runtime (`src/lib/agent/store.ts`), so `agent_codes`,
 * `agent_credentials`, and `agent_record_budgets` were live and disclosed
 * nowhere on this page until the union caught them. That test fails in both
 * directions: a live collection missing from this list, and a name kept
 * here after its last writer is gone — this page said search activity was
 * NOT in Firestore while search-log.ts wrote it there, and nothing caught
 * the drift until it was found by hand (fixed in 5d03378).
 */
export const FIRESTORE_COLLECTIONS_DISCLOSED: readonly string[] = [
  "agent_clients",
  "agent_codes",
  "agent_credentials",
  "agent_record_budgets",
  "app_config",
  "applications",
  "apply_counters",
  "connect_waitlist",
  "contact_messages",
  "credit_grants",
  "email_digest_state",
  "email_suppressions",
  "favorite_questions",
  "feedback",
  "follow_funnel_events",
  "followedCompanies",
  "interview_prep_cache",
  "interview_questions",
  "job_analyses",
  "job_views",
  "market_stats_daily",
  "profiles",
  "resume_history",
  "savedSearches",
  "search_events",
  "search_opens",
  "sources",
  "stories",
  "tailored_resumes",
  "users",
  "viewer_sessions",
  "waitlist",
  "welcome_emails",
];

export default function PrivacyPage() {
  return (
    <div data-testid="privacy-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-none border border-border bg-card p-6 sm:p-10">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <article className="prose prose-sm max-w-none dark:prose-invert">
        <p>
          velai is a job search tool. This page explains what we collect, why, and how you can control it. If
          anything here is unclear, use the contact page — we read every message ourselves.
        </p>

        <h2 className={LEGAL_H2}>What we collect</h2>
        <p>
          When you create an account, we collect the email address and profile information you provide. You can
          sign in with Google, a passkey, an email code, or a username and password. Google, passkey, and
          email-code sign-in run through WorkOS, our sign-in provider, which holds your account record under its
          own data-processing terms — we never see or store your Google password. Username-and-password sign-in
          is also processed by WorkOS.
        </p>
        <p>
          Once you&apos;re using velai, we store the things you create: your tracked applications, saved resumes,
          saved searches, and prep answers. This data lives in Google Cloud Firestore and is only
          ever accessed by our servers — never exposed directly to the browser or to other users.
        </p>
        <p>
          We also keep a record of what you do while searching: the searches you run (including the text of what
          you typed), which job postings come up, and which ones you click, open, save, or apply
          to. If you&apos;re signed in, we tie this to your account and build a profile of your search
          activity over time — what you&apos;re looking for, and what you actually respond to. Today this sits in
          Google Cloud Firestore, alongside the rest of your account data. We&apos;re moving it onto a
          PostgreSQL database we run on our own servers.
        </p>
        <p className="text-xs text-muted-foreground">
          For reference, the Firestore collections these storage claims cover today are:{" "}
          {FIRESTORE_COLLECTIONS_DISCLOSED.join(", ")}.
        </p>
        <p>
          If you join a waitlist (for example, &ldquo;tell me when it&apos;s ready&rdquo; on the connect page), we
          store the email address you enter and which product you asked about — nothing else — and use it only to
          send you that one notification. You don&apos;t need an account for this, and you can ask us to remove it
          at any time via the <Link href="/contact">contact page</Link>.
        </p>
        <p>
          If you sign up for weekly search alerts while browsing jobs without an account, we store the email
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
          text to Meilisearch. Location typeahead and facet pickers can send the place text you type to Meilisearch
          facet search so suggestions match the corpus.
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
          Subspace&apos;s schema), any notes you add, and your velai user id as <code className="text-xs">reporter_key</code>.
        </p>
        <p>
          We don&apos;t buy marketing profiles about you from data brokers.
        </p>

        <h2 className={LEGAL_H2}>How we use it</h2>
        <p>
          We use your account data to run the product: to show your tracked applications and keep your resumes and
          prep answers where you left them. We use your search-activity profile for two things: to make your own
          results more relevant the more you use velai, and, looked at in aggregate across everyone, to understand
          which kinds of job postings people actually apply to so we can improve search for everyone. velai is
          free to use — nothing you do draws on a balance or requires payment — and we don&apos;t sell any of this
          to advertisers.
        </p>

        <h2 className={LEGAL_H2}>AI processing</h2>
        <p>
          Some features — resume parsing (when you upload one) and resume tailoring — work by sending the relevant
          text (your resume, a job description) to an AI provider to generate a response. We use OpenRouter and Groq
          for this. That text is sent transiently to generate your result; it is not stored by us for any
          purpose beyond producing that response, and we don&apos;t use it to train anything. Each provider is
          bound by its own data-handling terms, which govern how they process the request while it&apos;s with
          them.
        </p>

        <h2 className={LEGAL_H2}>Connected AI clients</h2>
        <p>
          If you pair an AI client with velai from the <Link href="/connect">connect page</Link> (Claude,
          ChatGPT, Gemini, or another app that speaks MCP), that client can — after you sign in and approve the
          connection — read your saved resume, your tracked applications, and your job preferences, and save
          changes back when you tell it to. Anything your AI client reads travels to that provider and is handled
          under <em>their</em> privacy terms, not ours — we can&apos;t control what the provider you chose retains
          or how it uses what it processes. This only ever happens for a client you connected yourself, and you
          can disconnect it at any time from <Link href="/settings">account settings</Link>, which cuts off all
          further access.
        </p>

        <h2 className={LEGAL_H2}>Email</h2>
        <p>
          We send email through Resend, a transactional email provider, which processes your address and message
          content on our behalf under its own processor terms. Beyond your address itself, we store which kind of
          email you&apos;ve been sent (a waitlist confirmation, the weekly digest) and its delivery status (sent,
          bounced, or marked as spam) — not the content of what we send you.
        </p>
        <p>
          Every email that isn&apos;t a direct response to something you just did — the weekly digest, a waitlist
          confirmation — includes an unsubscribe link that works without signing in and takes effect immediately.
          If an email to your address bounces, or you mark one as spam, we stop sending to that address
          automatically. You can also turn the weekly digest on or off directly from{" "}
          <Link href="/settings">account settings</Link>.
        </p>

        <h2 className={LEGAL_H2}>Behavioural analytics ledger</h2>
        <p>
          Alongside PostHog (below), we keep a separate behavioural ledger in a PostgreSQL database we run. Your
          browser batches product events to our telemetry API — the same catalogue of actions we use to understand
          search and apply funnels. Each row can include: {TELEMETRY_LEDGER_FIELDS_DISCLOSED.join(", ")}. The{" "}
          <code className="text-xs">props</code> field holds event-specific metadata (for example query length or
          filter counts — not the full text of what you typed). When you&apos;re signed in, our server stamps your
          user id on each row; guests send only session and visitor ids generated in the browser. We use this
          ledger to improve search quality and to compute aggregate statistics. Rows are deleted after 90 days.
        </p>

        <h2 className={LEGAL_H2}>Cookies &amp; analytics</h2>
        <p>
          We use a session cookie to keep you signed in. It&apos;s httpOnly (invisible to page scripts) and
          identifies your session — nothing more. The jobs board sets one more tiny cookie the first time you
          visit: a returning-visitor flag (literally the value 1, with no identifier in it), so the front door
          can skip the first-visit intro next time.
        </p>
        <p>
          We use PostHog for product analytics — page views, clicks, and searches — so we can see what&apos;s
          working and fix what isn&apos;t. velai shares one PostHog project with thesubspace.io; we tell events
          apart with a product tag in the analytics payload, not a separate project. PostHog&apos;s US cloud (
          <code className="text-xs">us.posthog.com</code>, configured as our analytics UI host) processes the data
          as our processor under their own DPA terms. Browser requests are sent through our own{" "}
          <code className="text-xs">/ph</code> proxy path rather than directly to third-party analytics domains.
        </p>
        <p>
          PostHog runs cookieless on velai: no analytics cookie is set. What PostHog needs to hold on to lives in
          your browser&apos;s per-tab storage, so a reload doesn&apos;t restart your session, nothing is shared
          with your other tabs, and all of it is discarded when you close the tab. PostHog events are not linked
          to your velai account id unless you&apos;re signed in and we identify your session to PostHog — signed-out
          visits still send page and interaction events. At the PostHog project level, IP addresses are stored (
          IP anonymization is off), including for signed-out visitors. We don&apos;t run ad trackers or any third-party tracking pixels, and beyond
          the two cookies above velai sets none. The Cloudflare Turnstile check on our contact and sign-up forms
          runs in its own frame and may use its own storage under Cloudflare&apos;s terms to tell humans from
          bots.
        </p>
        <p>
          PostHog session replay is enabled. Replays capture the pages you saw, how you moved through them, console
          logs, and performance data from the session. Input masking is on: anything you type is masked before it
          leaves your browser — we can see that you filled in a field, not what you put in it. Replays are kept
          for 30 days in PostHog, then expire under PostHog&apos;s own retention rules. A replay covers a single
          tab and is tied to your identity only if you&apos;re signed in.
        </p>
        <p>
          PostHog also powers heatmaps, in-app feedback surveys, and short forms when a search returns no results.
          Surveys may optionally ask for your email address; we use it only to notify you when matching jobs arrive
          or to follow up on feedback. The field is optional, and every survey works without it. On phone-sized
          viewports we disable automatic survey UI so it does not overlap page content.
        </p>

        <h2 className={LEGAL_H2}>Where data is processed</h2>
        <p>
          You may be in one country while our providers and infrastructure operate elsewhere. We have not verified
          or published a single home region for every data store behind velai. PostHog product analytics are
          processed in the United States — our app is configured to use PostHog&apos;s US cloud (
          <code className="text-xs">us.posthog.com</code>). Other processing — including account data in Google
          Cloud Firestore, search indexes, email delivery, sign-in through WorkOS, and databases we operate — may
          run outside your country, including in the United States, without us naming a region we have not
          confirmed in configuration.
        </p>

        <h2 className={LEGAL_H2}>Retention &amp; deletion</h2>
        <p>
          We keep your account data for as long as your account is active. Search-activity records in Firestore —
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
          That server action removes your Firestore profile and every user-owned collection in our migration manifest
          (for example applications, resumes, saved searches, prep answers, agent credentials, and email digest
          state keyed to your account), deletes your WorkOS sign-in record, and — when your login email is a real
          address, not a synthetic username-only address — runs our identity-forget path: global email suppression
          for that address, deletion from our intervu identity store, and deletion of behavioural-ledger rows in
          PostgreSQL keyed to your WorkOS user id.
        </p>
        <p>
          Self-serve account deletion makes no call to PostHog to delete data and does not remove analytics
          events or replay-derived data already stored there. Session replay recordings in PostHog are kept for
          30 days, as described above, then expire under PostHog&apos;s rules. We have not confirmed a fixed
          retention period for ordinary analytics events or heatmap data in PostHog. It does not remove contact-form messages,
          connect-waitlist entries, or other records stored only by email without an account id. Anonymous search
          logs and aggregate statistics are unaffected. Suppression entries for your address stay in place so we do
          not resume email after you leave.
        </p>
        <p>
          We do not offer a separate bulk export or machine-readable download of your stored account data. If you
          need account-held data removed, use self-serve deletion above or email us for help removing waitlist or
          contact-form records that are not tied to an account.
        </p>

        <h2 className={LEGAL_H2}>Your choices</h2>
        <p>
          You can edit or delete content you created in the product. To remove your entire account, use the
          self-serve flow in account settings ({ACCOUNT_SELF_SERVE_DELETION_FLOW}). For questions about privacy or
          deletion, email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>

        <h2 className={LEGAL_H2}>Contact</h2>
        <p>
          Questions: email{" "}
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="text-foreground underline">
            {PUBLIC_SUPPORT_EMAIL}
          </a>{" "}
          or use the <Link href="/contact">contact page</Link>.
        </p>
      </article>
      </div>
    </div>
  );
}
