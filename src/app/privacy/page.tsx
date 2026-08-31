import type { Metadata } from "next";
import Link from "next/link";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { LegalDocHeader } from "@/components/legal/LegalDocHeader";

const TITLE = "Privacy Policy";
const DESCRIPTION = "How velai collects, uses, and protects your data.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/privacy", TITLE, DESCRIPTION),
};

const LAST_UPDATED = "August 31, 2026";

export default function PrivacyPage() {
  return (
    <main data-testid="privacy-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="rounded-none border border-border/80 bg-card/75 p-6 sm:p-10 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.45)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
        <LegalDocHeader title={TITLE} lastUpdated={LAST_UPDATED} />

        <article className="prose prose-sm max-w-none dark:prose-invert">
        <p>
          velai is a job search tool. This page explains what we collect, why, and how you can control it. If
          anything here is unclear, use the contact page — we read every message ourselves.
        </p>

        <h2>What we collect</h2>
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
          If you join a waitlist (for example, &ldquo;tell me when it&apos;s ready&rdquo; on the connect page), we
          store the email address you enter and which product you asked about — nothing else — and use it only to
          send you that one notification. You don&apos;t need an account for this, and you can ask us to remove it
          at any time via the <Link href="/contact">contact page</Link>.
        </p>
        <p>
          When you search, we read your IP address transiently for two things: to default your job search to your
          country so first results are nearby, and to rate-limit abusive traffic. Your IP is not stored with your
          account, your searches, or your tracked applications — the country lookup happens on our own server
          against a local database, with no third-party geolocation service involved. Like nearly every website,
          our servers keep ordinary technical logs that can briefly include request IPs.
        </p>
        <p>
          The job listings you search are public information we collect from employers&apos; own career pages. We
          don&apos;t collect anything about you from third parties, and we don&apos;t buy data about you from
          anyone.
        </p>

        <h2>How we use it</h2>
        <p>
          We use your account data to run the product: to show your tracked applications and keep your resumes and
          prep answers where you left them. velai is free to use — nothing you do draws on a balance or requires
          payment. That&apos;s it — we don&apos;t use your data to train models, and we don&apos;t build
          advertising profiles.
        </p>

        <h2>AI processing</h2>
        <p>
          Some features — resume parsing (when you upload one) and resume tailoring — work by sending the relevant
          text (your resume, a job description) to an AI provider to generate a response. We use OpenRouter and Groq
          for this. That text is sent transiently to generate your result; it is not stored by us for any
          purpose beyond producing that response, and we don&apos;t use it to train anything. Each provider is
          bound by its own data-handling terms, which govern how they process the request while it&apos;s with
          them.
        </p>

        <h2>Connected AI clients</h2>
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

        <h2>Email</h2>
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

        <h2>Cookies &amp; analytics</h2>
        <p>
          We use a session cookie to keep you signed in. It&apos;s httpOnly (invisible to page scripts) and
          identifies your session — nothing more. The jobs board sets one more tiny cookie the first time you
          visit: a returning-visitor flag (literally the value 1, with no identifier in it), so the front door
          can skip the first-visit intro next time.
        </p>
        <p>
          We use PostHog for product analytics — page views, clicks, and searches — so we can see what&apos;s
          working and fix what isn&apos;t. It runs cookieless on velai: no analytics cookie is set. What PostHog
          needs to hold on to lives in your browser&apos;s per-tab storage, so a reload doesn&apos;t restart your
          session, nothing is shared with your other tabs, and all of it is discarded when you close the tab.
          Events aren&apos;t tied to your identity unless you&apos;re signed in. PostHog (US cloud) processes this
          data as our processor under their own DPA terms. We don&apos;t run ad trackers or any third-party
          tracking pixels, and beyond the two cookies above velai sets none. The Cloudflare Turnstile check on
          our contact and sign-up forms runs in its own frame and may use its own storage under
          Cloudflare&apos;s terms to tell humans from bots.
        </p>
        <p>
          PostHog also records a replay of your visit — the pages you saw and how you moved through them — so we
          can find the places where the product gets in your way. Anything you type is masked before it leaves
          your browser: we can see that you filled in a field, never what you put in it. A replay covers a single
          tab, and is tied to your identity only if you&apos;re signed in.
        </p>
        <p>
          PostHog also powers in-app feedback surveys — a feedback tab and short forms when a search returns no
          results — that may optionally ask for your email address. We use it only to notify you when matching
          jobs arrive or to follow up on your feedback; the field is optional, and every survey works without it.
        </p>

        <h2>Retention &amp; deletion</h2>
        <p>
          We keep your data for as long as your account is active. You can delete your account and everything tied
          to it at any time from <Link href="/settings">account settings</Link> — it&apos;s self-serve, not a
          support ticket. Deletion removes your profile, tracked applications, resumes, and prep answers from our
          systems.
        </p>

        <h2>Your choices</h2>
        <p>
          You control your data: edit or remove anything you&apos;ve created, delete your account outright, or
          contact us with any question or request — including one we haven&apos;t anticipated here.
        </p>

        <h2>Contact</h2>
        <p>
          Questions: use the <Link href="/contact">contact page</Link>.
        </p>
      </article>
      </div>
    </main>
  );
}
