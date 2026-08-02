import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How intervu collects, uses, and protects your data.",
};

const LAST_UPDATED = "August 1, 2026";

export default function PrivacyPage() {
  return (
    <main data-testid="privacy-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-display font-extrabold text-foreground">Privacy Policy</h1>

      <article className="prose prose-sm mt-6 max-w-none dark:prose-invert">
        <p>Last updated: {LAST_UPDATED}</p>

        <p>
          intervu is a job search tool. This page explains what we collect, why, and how you can control it. If
          anything here is unclear, use the contact page — we read every message ourselves.
        </p>

        <h2>What we collect</h2>
        <p>
          When you create an account, we collect the email address and profile information you provide. You can
          sign in with Google or with a username and password — Google-hosted sign-in is handled by Firebase Auth,
          so we never see or store your Google password.
        </p>
        <p>
          Once you&apos;re using intervu, we store the things you create: your tracked applications, saved resumes,
          prep answers, and credit balance. This data lives in Google Cloud Firestore and is only ever accessed by
          our servers — never exposed directly to the browser or to other users.
        </p>
        <p>
          The job listings you search are public information we collect from employers&apos; own career pages. We
          don&apos;t collect anything about you from third parties, and we don&apos;t buy data about you from
          anyone.
        </p>

        <h2>How we use it</h2>
        <p>
          We use your account data to run the product: to show your tracked applications, keep your resumes and
          prep answers where you left them, and apply your credit balance when you use a paid feature. That&apos;s
          it — we don&apos;t use your data to train models, and we don&apos;t build advertising profiles.
        </p>

        <h2>AI processing</h2>
        <p>
          Some features — resume tailoring and interview prep critique — work by sending the relevant text (your
          resume, a job description, your prep answers) to an AI provider to generate a response. We use OpenRouter
          and Groq for this. That text is sent transiently to generate your result; it is not stored by us for any
          purpose beyond producing that response, and we don&apos;t use it to train anything. Each provider is
          bound by its own data-handling terms, which govern how they process the request while it&apos;s with
          them.
        </p>

        <h2>Cookies</h2>
        <p>
          We use a single cookie to keep you signed in. It&apos;s httpOnly (invisible to page scripts), lasts about
          14 days, and identifies your session — nothing more. We don&apos;t run analytics scripts, ad trackers, or
          any third-party tracking pixels. No cookie on intervu follows you around the web.
        </p>

        <h2>Retention &amp; deletion</h2>
        <p>
          We keep your data for as long as your account is active. You can delete your account and everything tied
          to it at any time from <Link href="/settings">account settings</Link> — it&apos;s self-serve, not a
          support ticket. Deletion removes your profile, tracked applications, resumes, prep answers, and credit
          history from our systems.
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
    </main>
  );
}
