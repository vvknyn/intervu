/**
 * Every outside service that receives a visitor's or user's personal data, as
 * /privacy ("Who handles your data") lists them. One list: the page renders
 * it, and tests/unit/privacy-processors-disclosed.test.ts fails when server
 * code calls a host or SDK that is neither mapped here nor in
 * NO_PERSONAL_DATA_HOSTS.
 *
 * `hosts` / `packages` are the code-side markers the test maps outbound calls
 * to (a host matches itself and its subdomains). They are not rendered.
 * Hosts that arrive through env vars (our database, Meilisearch, the Subspace
 * API, the tinfoil enclave named by the browser) have no literal in src, so
 * the scan cannot see them; their rows are kept by hand.
 */
export interface Processor {
  name: string;
  receives: string;
  why: string;
  retention: string;
  hosts: readonly string[];
  packages: readonly string[];
}

const UNCONFIRMED = "We have not confirmed a retention period.";

export const PROCESSORS: readonly Processor[] = [
  {
    name: "Our servers (app, Postgres database, Meilisearch)",
    receives: "Everything you give Velai: your account, saved résumé and matches, searches you run.",
    why: "To run Velai.",
    retention:
      "Kept until you delete it. Résumés and matches are deleted 90 days after paid time ends. The anonymous search record is deleted after 90 days.",
    hosts: [],
    packages: [],
  },
  {
    // DEPLOY.md:6 names the Contabo VPS as the production host.
    name: "Contabo (the hosting company for our servers)",
    receives: "Everything held on our servers, above, including the database, as the machine it runs on.",
    why: "Hosts the app and its database.",
    retention: "Same as the row above: it holds our servers.",
    hosts: [],
    packages: [],
  },
  {
    // deploy/Caddyfile:3-21 and src/lib/shield/client-ip.ts:16 describe Cloudflare as the outermost edge.
    name: "Cloudflare (CDN and proxy in front of velai.app)",
    receives:
      "Every request to velai.app passes through it, so it sees your IP address, the addresses of the pages you request and your browser's request headers. Cloudflare Web Analytics is off.",
    why: "Delivers the site and shields it from attacks.",
    retention: "Set by Cloudflare. We have not confirmed a period.",
    hosts: [],
    packages: [],
  },
  {
    name: "Subspace (thesubspace.io)",
    receives:
      "Job identifiers, to fill in descriptions. When you report a listing: the job URL, title, the report category you chose, any notes you add, and your Velai user id as reporter_key. Never your résumé or searches.",
    why: "Source of the public job listings, and where a report about one goes.",
    retention: "We have not confirmed a retention period.",
    hosts: [],
    packages: [],
  },
  {
    name: "Tinfoil sealed AI",
    receives:
      "Résumé text with your name, email, phone and links taken out, or only the lines for one job or one question. Encrypted so only the sealed server can read it.",
    why: "Résumé AI: reading, tailoring, drafting answers. Runs for paid accounts only.",
    retention: UNCONFIRMED,
    hosts: [],
    packages: [],
  },
  {
    name: "OpenRouter",
    receives:
      "Only the words you typed in a job search, no account id. Sent only if the JOBS_LLM_UNDERSTANDING switch is on, with zero data retention requested on each request.",
    why: "Turn a plain-language search into filters.",
    retention: UNCONFIRMED,
    hosts: ["openrouter.ai"],
    packages: ["openai"],
  },
  {
    name: "PostHog (US cloud)",
    receives:
      "Page views and named actions, sent through our own /ph path. Your IP address is removed on our server first. No replay, no click capture, no profile, no account id.",
    why: "Anonymous product analytics.",
    retention: UNCONFIRMED,
    hosts: ["posthog.com"],
    packages: ["posthog-js"],
  },
  {
    name: "Stripe",
    receives:
      "Your email and card details, entered on Stripe's checkout page. We store only your Stripe customer id and the date your paid time ends.",
    why: "Payment for 1 to 12 prepaid months at $12 a month.",
    retention: "Set by Stripe. We have not confirmed a period.",
    hosts: [],
    packages: ["stripe"],
  },
  {
    name: "WorkOS",
    receives: "Your email and how you sign in (Google, passkey, email code, or password).",
    why: "Sign-in.",
    retention: "Kept until you delete your account, which deletes the WorkOS record.",
    hosts: ["workos.com"],
    packages: ["@workos-inc/"],
  },
  {
    name: "Resend",
    receives: "Your email address and the message we send you.",
    why: "Sign-in codes, digests, and other email.",
    retention: UNCONFIRMED,
    hosts: [],
    packages: ["resend"],
  },
  {
    name: "Cloudflare Turnstile",
    receives: "What your browser shares to prove you are not a bot, on the contact and sign-up forms.",
    why: "Stop spam.",
    retention: "Set by Cloudflare.",
    hosts: ["challenges.cloudflare.com"],
    packages: [],
  },
  {
    // Reachable only from deleteAccount (src/actions/auth.ts:460,466): admin.ts:87 getAuth().deleteUser(uid);
    // erase-account.ts:309 opens Firestore (admin.ts getFirestoreDb) and sweeps it by account id and email.
    // Both need a Firebase credential (hasFirebaseCredentials). Sign-in and normal use never call Firebase.
    name: "Google Firebase (old sign-in service and old database)",
    receives:
      "Nothing during sign-in or normal use. Only when you delete your account, and only while a Firebase credential is configured: your account id, to delete an old sign-in record, and your account id and email address, to find and delete leftover copies of your account data in Firestore.",
    why: "Clean-up of the service that was our sign-in and database before WorkOS and Postgres.",
    retention: "Deleted when you delete your account.",
    hosts: [],
    packages: ["firebase-admin"],
  },
];

/**
 * Hosts server code calls that carry no personal data. One line of reason
 * each; a host not here and not in PROCESSORS fails the privacy test.
 */
export const NO_PERSONAL_DATA_HOSTS: Readonly<Record<string, string>> = {
  "www.google.com": "src/lib/companies/logo-proxy.ts:11,38 fetches the favicon server-side; the URL carries only the company domain and no visitor IP, headers or cookies are forwarded.",
  "velai.app": "src/lib/billing/stripe-client.ts:18 sends our own site address to Stripe as the app label; no user data.",
};
