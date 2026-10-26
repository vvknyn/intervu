import { MAX_MONTHS, MIN_MONTHS, PRO_MONTHLY_PRICE } from "@/app/pricing/offer";

/**
 * Every outside service that receives a visitor's or user's personal data, as
 * /privacy ("Who handles your data") lists them. One list: the page renders
 * it, and tests/unit/privacy-processors-disclosed.test.ts fails when any
 * network address in src/ (server or browser code, TypeScript strings and CSS)
 * is in none of PROCESSORS and, for that file, NO_PERSONAL_DATA_HOSTS and
 * NOT_CONTACTED_HOSTS, or when an imported package is classified nowhere.
 *
 * `hosts` / `packages` are the code-side markers the test maps outbound calls
 * to (a host matches itself and its subdomains). They are not rendered.
 * Rows with no hosts and no packages are kept by hand: their addresses come
 * from env vars, from what you type, or from software outside src/, so no
 * literal in src names them and the scan cannot see them.
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
    receives:
      "Velai runs on several servers rented from Contabo (the app, the database and the search engine), so everything held on our servers, above, sits on Contabo's machines.",
    why: "Hosts the app, its database and search.",
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
    // Reporter key: src/lib/jobs/reporter-key.ts:13-16 (uid, or "anon:" + HMAC-SHA256 of the client IP).
    name: "Subspace (thesubspace.io)",
    receives:
      "The ids of the jobs shown in a list or opened, to fill in descriptions and to check they are still live, with no account id. The web address of a company (for example example.com) when you open its page, to fetch its news and events. When you report a listing: the job URL, title, the report category you chose, any notes you add, and a reporter key. The key is your Velai user id if you are signed in; if you are signed out it is the word anon, a colon, and a one-way scrambled code of your IP address, made with a secret key we hold, so the same visitor counts once. Never your résumé or searches.",
    why: "Source of the public job listings, and where a report about one goes.",
    retention: "We have not confirmed a retention period.",
    hosts: [],
    packages: [],
  },
  {
    name: "Tinfoil sealed AI",
    receives:
      "Résumé text with your name, email, phone and links taken out, or only the lines for one job or one question. It is encrypted in your browser to the sealed server's own key and passes through our server, which cannot read it. Separately, before the first sealed request after a page loads (when a paid account imports a résumé or tailors one to a job), your browser itself contacts Tinfoil's servers (atc, github-proxy and kds-proxy at tinfoil.sh, plus the sealed server's own address) to check the sealed server is genuine, so Tinfoil sees your IP address and browser details.",
    why: "Résumé AI: reading, tailoring, drafting answers. Runs for paid accounts only.",
    retention: UNCONFIRMED,
    hosts: [],
    packages: ["tinfoil"],
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
    // IP removal: the live Caddyfile (interview-os repo, /opt/interview-os/deploy/contabo-web/caddy/Caddyfile
    // lines 109-126, mounted in contabo-web-caddy-1) strips X-Forwarded-For, X-Real-IP, CF-Connecting-IP(v6),
    // Forwarded and the CF geo headers on /ph. This repo's deploy/Caddyfile is not mounted in prod.
    // Account deletion: src/lib/account/erase-account.ts:269-283 (distinct_id lookup, then DELETE person).
    // Logs: src/lib/observability/posthog-logs.ts (sanitizeLogAttrs, redactLogBody, buildOtlpPayload).
    name: "PostHog (US cloud)",
    receives:
      "Page views and named actions, sent through our own /ph path; your IP address is removed on our server before anything is passed on. Each one carries the address of the page with any text after a ? or # removed, your browser, system and device type, your language and your time zone, and a random code that lasts only for that browser tab. No replay, no click capture, no profile, and no account id while you use Velai. Our own server also reports some events itself (a job alert sign-up and confirmation, a sign-in step succeeding or failing, each AI request our servers make, each tool call an AI app makes to Velai). Those carry counts and outcomes only (such as how many characters a search had, or how long a call took), never what you typed, your account id or your IP address; each gets its own random code and is linked to no profile. A tool-call event also carries the AI app's name (the first 80 characters of its User-Agent) and a session code that app chooses. When you delete your account, your account id is sent so your analytics record can be deleted. Also our server logs: a short fixed sentence (any email address, IP address or web-address query in it is replaced by \"[redacted]\" before sending), the time, how serious it is, and a few short technical codes such as which step failed, how long it took, and the web address of the company involved.",
    why: "Anonymous product analytics, and error and slow-request logs.",
    retention: UNCONFIRMED,
    hosts: ["posthog.com"],
    packages: ["posthog-js"],
  },
  {
    // Account id: src/lib/billing/checkout.ts:36-38 (client_reference_id, metadata), :76 (customer metadata).
    name: "Stripe",
    receives:
      "Your email and card details, entered on Stripe's checkout page. We also send your Velai account id, as the payment reference and in the notes attached to the payment and to your Stripe customer record. From Stripe we keep your Stripe customer id and the date your paid time ends.",
    why: `Payment for ${MIN_MONTHS} to ${MAX_MONTHS} prepaid months at ${PRO_MONTHLY_PRICE} a month.`,
    retention: "Set by Stripe. We have not confirmed a period.",
    hosts: [],
    packages: ["stripe"],
  },
  {
    // Password: auth-action-deps.ts:31 createUser({email, password, metadata:{username}}); resetPassword. Username + "apps"
    // tag in metadata: auth.ts:96, provisioning.ts:50/105-109; membership in a WorkOS organization (provisioning.ts:104).
    // Google name/photo: workos-identity.ts:30-32 (firstName, lastName, profilePictureUrl); avatar ignores the photo (user-avatar.tsx).
    name: "WorkOS",
    receives:
      "Your email address. If you make an account with a password, the password too, so WorkOS can check it at sign-in, plus the username you chose and an internal tag marking that you use Velai. If you sign in with Google, the first and last name and the profile picture address Google gives WorkOS. WorkOS also handles passkeys and email sign-in codes. Velai never loads the Google profile picture; it shows your initials instead.",
    why: "Sign-in.",
    retention: "Kept until you delete your account, which deletes the WorkOS record.",
    hosts: ["workos.com"],
    packages: ["@workos-inc/"],
  },
  {
    // The only provider the sign-in screen names: login-form.tsx:361 startAuthKit("GoogleOAuth"); /auth/start forwards it to WorkOS.
    name: "Google (sign-in)",
    receives:
      "If you choose Continue with Google, your browser goes to Google's sign-in page. Google learns that you are signing in to Velai (through WorkOS), and you choose what it shares. It hands WorkOS your email address, name and profile picture address.",
    why: "Lets you sign in with your Google account.",
    retention: "Set by Google. We have not confirmed a period.",
    hosts: [],
    packages: [],
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
    // Mounted by <TurnstileWidget> on some forms only (grep TurnstileWidget); the row names no list, so it cannot go stale.
    // Server check: src/lib/shield/turnstile.ts:106-109 posts the token and remoteip to siteverify.
    name: "Cloudflare Turnstile",
    receives:
      "What your browser shares to prove you are not a bot, on the Velai forms that show Cloudflare's human check. When you submit one, our server also sends Cloudflare your IP address so it can check the result.",
    why: "Stop spam.",
    retention: "Set by Cloudflare.",
    hosts: ["challenges.cloudflare.com"],
    packages: [],
  },
  {
    // Browser side: src/components/viewer/watch-canvas.tsx:174. Laptop side: openclaw/scripts/viewer/transport-webrtc.mjs:18
    // (same server), created at openclaw/scripts/viewer.mjs:170.
    name: "Google (connection helper for watching your laptop)",
    receives:
      "When you watch your own laptop session from /watch/[id], your browser, and the Velai helper app on your laptop, each ask a Google server (stun.l.google.com) how to reach each other. Google receives your IP address and connection details. The screen itself goes straight between your devices, not through Google.",
    why: "Lets your phone or browser connect directly to your laptop.",
    retention: "Set by Google. We have not confirmed a period.",
    hosts: ["stun.l.google.com"],
    packages: [],
  },
  {
    // Server side: src/actions/fetch-url.ts:36 (fetch of the pasted URL, headers FETCH_HEADERS, no cookies, our server's address);
    // discoverLinks (:130) re-reads the pasted page to list up to 20 same-site links; the linked pages are fetched
    // only for links you select (SourcesManager.tsx:216, fetchUrlContent).
    // Browser side: src/lib/jobs/apply-url-health.ts:67,77 (HEAD/GET, credentials omitted, mode cors) via
    // JobsContent.tsx:3658-3660, which runs after the posting tab is opened.
    // Click-only navigation (like Stripe/WorkOS pages): job-handoff.ts:44-45 builds claude.ai/new?q= and
    // chatgpt.com/?q= with the job id, title, company and location; opened by McpHandoffActions / ApplyIntentDialog.
    name: "Websites you ask Velai to read or open",
    receives:
      "A website you paste into Velai to read (for example a job page you add as a source) receives that web address and our server's address, not yours. Velai also reads that page again to list up to 20 links on the same site; those pages are fetched only if you pick them. When you click through to a job posting, the posting opens, and right after, your browser makes a quick check that the link still works, so that posting's site receives the link, your IP address and the fact that the request came from velai.app, with no cookies. When you choose to continue a job in Claude or ChatGPT, the new tab opens claude.ai or chatgpt.com with the job's id, title, company and location in the link.",
    why: "Reads the page you point us at, and notes dead job links so they are skipped next time. The Claude and ChatGPT links hand a job to the assistant you connected.",
    retention: "Set by each website. We cannot know it.",
    hosts: [],
    packages: [],
  },
  {
    // Server side, a scheduled batch outside src/ (interview-os repo, scripts/jobs-sync/push-company-site-names.mjs:85,133-148,493):
    // POSTs SPARQL to query.wikidata.org carrying company website addresses, then the matched Wikidata ids; user agent
    // VelaiSiteNames/1.0 with the operator's contact email (:86). Never run by a visitor's request; the result is stored
    // on the company's search record and read from there (get-company.ts:251).
    // Browser side: src/lib/companies/company-facts.ts:231 builds the "Wikidata" source link shown on a company page
    // (CompanySections.tsx:111, target=_blank, noopener); the browser contacts wikidata.org only when you click it.
    name: "Wikidata (public company facts)",
    receives:
      "On a schedule, not when you visit, our servers ask Wikidata (query.wikidata.org) for each company's public entry, sending a list of company website addresses and then the matching Wikidata ids, with a contact email for Velai's operator in the request header. No visitor data is involved. A company page that shows a Wikidata fact links to that entry; only if you click the link does your browser contact wikidata.org, and Wikidata then sees your IP address and browser details under its own policy.",
    why: "Fills in a company's founding year, headquarters country, size, description and industry when we have no better source, and names Wikidata as the source.",
    retention: "Set by Wikidata for what it logs. We keep the facts we read from it on the company's record and look them up again about every 30 days.",
    hosts: ["wikidata.org"],
    packages: [],
  },
  {
    // Optional, openclaw/scripts/viewer/tailnet.mjs:131-156 (install via brew or tailscale.com/install.sh, then `tailscale up`);
    // /watch/anywhere (src/app/watch/anywhere/page.tsx) tells you to install the app. Claims about encryption and what
    // Tailscale sees: https://tailscale.com/security ("All traffic is end-to-end encrypted, always"; "Tailscale does not
    // (and cannot) inspect your traffic"; the coordination server holds public keys and metadata about which nodes connect).
    name: "Tailscale (optional, for watching from anywhere)",
    receives:
      "Only if you choose Watch from anywhere and set up Tailscale on your laptop and phone. You sign in to Tailscale with your own account there. Tailscale says its traffic between your devices is end-to-end encrypted and that it cannot inspect it; what it does see is which of your devices connect to which, and their public IP addresses (https://tailscale.com/security). Velai does not send it anything.",
    why: "Lets your phone reach the laptop session over mobile data. Not used otherwise.",
    retention: "Set by Tailscale. We have not confirmed a period.",
    hosts: [],
    packages: [],
  },
  {
    // public/install:87,136,142 (nodejs.org, only via ensure_node when npm is missing, Mac only) and :210,261,386 (npm install of openclaw, mcporter, and the skill's packages).
    name: "Software download sites (optional laptop install command)",
    receives:
      "Only if you run Velai's install command on your own computer. It downloads Node.js from nodejs.org when your computer has none, and installs packages from the npm registry. Those sites see your IP address and which software you asked for. No Velai account data is sent to them.",
    why: "Sets up the helper that runs on your laptop.",
    retention: "Set by each site. We cannot know it.",
    hosts: [],
    packages: [],
  },
  {
    // Reachable only from deleteAccount (src/actions/auth.ts:460,466): admin.ts:87 getAuth().deleteUser(uid);
    // erase-account.ts:309 opens Firestore (admin.ts getFirestoreDb) and sweeps it by account id and email.
    // Prod has FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY set (measured Oct 24), so every deletion contacts Firebase.
    // Sign-in and normal use never call Firebase.
    name: "Google Firebase (old sign-in service and old database)",
    receives:
      "Nothing during sign-in or normal use. When you delete your account: your account id, to delete an old sign-in record, and your account id and email address, to find and delete leftover copies of your account data in Firestore.",
    why: "Clean-up of the service that was our sign-in and database before WorkOS and Postgres.",
    retention: "Deleted when you delete your account.",
    hosts: [],
    packages: ["firebase-admin"],
  },
];

/** A host the scan finds only in `files` (repo-relative); the same host in any other file fails the privacy test. */
export interface ScopedHost {
  files: readonly string[];
  reason: string;
}

/**
 * Hosts that carry no personal data, each tied to the files it appears in. One
 * line of reason each; a host not here (for that file) and not in PROCESSORS
 * fails the privacy test.
 */
export const NO_PERSONAL_DATA_HOSTS: Readonly<Record<string, ScopedHost>> = {
  "www.google.com": { files: ["src/lib/companies/logo-proxy.ts"], reason: "src/lib/companies/logo-proxy.ts:11,38 fetches the favicon server-side; the URL carries only the company domain and no visitor IP, headers or cookies are forwarded." },
  "velai.app": { files: ["src/components/mock/CompletenessMock.tsx", "src/lib/agent/config.ts", "src/lib/billing/stripe-client.ts"], reason: "our own site address: stripe-client.ts sends it to Stripe as the app label, agent/config.ts uses it as the default MCP issuer id, CompletenessMock.tsx shows it in sample text; nothing is sent to anyone." },
};

/** Addresses in src, each tied to the files it appears in, that are only a link the user clicks, a namespace or schema id, a docs reference, a placeholder or sample value. Never requested by us or by the page on its own. */
export const NOT_CONTACTED_HOSTS: Readonly<Record<string, ScopedHost>> = {
  "thesubspace.io": { files: ["src/app/about/page.tsx", "src/components/layout/Footer.tsx"], reason: "plain links to our sister product (about page, footer, blog posts); the Subspace API itself comes from an env var, see the Subspace row." },
  "tinfoil.sh": { files: ["src/app/privacy/page.tsx"], reason: "a plain link to Tinfoil's site in the privacy page text; the sealed-AI calls are the Tinfoil row." },
  "claude.ai": { files: ["src/lib/connect-clients.ts", "src/lib/mcp/job-handoff.ts"], reason: "job-handoff.ts builds claude.ai/new?q=... carrying the job id, title, company and location, and it is opened only when you click Continue in Claude (the browser goes there, not our server); connect-clients.ts links only to claude.ai/settings/connectors, carrying nothing." },
  "chatgpt.com": { files: ["src/lib/connect-clients.ts", "src/lib/mcp/job-handoff.ts"], reason: "job-handoff.ts builds chatgpt.com/?q=... carrying the job id, title, company and location, and it is opened only when you click Continue in ChatGPT (the browser goes there, not our server); connect-clients.ts links only to the chatgpt.com home page, carrying nothing." },
  "gemini.google.com": { files: ["src/lib/connect-clients.ts"], reason: "src/lib/connect-clients.ts:70: a link opened only when you click it." },
  "cursor.com": { files: ["src/lib/connect-clients.ts"], reason: "src/lib/connect-clients.ts:78: a link opened only when you click it." },
  "chromewebstore.google.com": { files: ["src/lib/brand/extension-store.ts"], reason: "src/lib/brand/extension-store.ts:6: the extension's store link (ExtensionTile.tsx); opened only on click." },
  "www.reddit.com": { files: ["src/lib/blog/same-resume-test-october-2026.ts"], reason: "src/lib/blog/same-resume-test-october-2026.ts:4: a source link in a blog post." },
  "consumer.ftc.gov": { files: ["src/lib/blog/is-velai-legit.ts"], reason: "a link in blog text." },
  "jobshifu.com": { files: ["src/lib/blog/velai-vs-jobshifu.ts"], reason: "src/lib/blog/velai-vs-jobshifu.ts: links in a comparison blog post." },
  "schema.org": { files: ["src/lib/seo/jsonld.ts"], reason: "src/lib/seo/jsonld.ts: the JSON-LD @context namespace id, written into page markup; nothing fetches it." },
  "www.w3.org": { files: ["src/app/stories/page.tsx", "src/components/marketing/LandingAnimatedBackground.tsx", "src/components/marketing/WhatsAppThreadHero.tsx"], reason: "the SVG xmlns namespace id on inline icons; browsers do not fetch it." },
  "ko-fi.com": { files: ["src/components/admin/AdminPanel.tsx"], reason: "src/components/admin/AdminPanel.tsx:138: an input placeholder in the admin panel." },
  "boards.greenhouse.io": { files: ["src/components/tracker/TrackRoleSheet.tsx"], reason: "src/components/tracker/TrackRoleSheet.tsx:86: an input placeholder." },
  "example.com": { files: ["src/app/mock/company-page/page.tsx", "src/app/mock/history/HistoryMockClient.tsx", "src/components/mock/RelatedJobsMock.tsx", "src/components/settings/SourcesManager.tsx", "src/lib/jobs/for-you/mock-deck-fixtures.ts"], reason: "placeholder and sample values (SourcesManager.tsx:354 input placeholder; mock pages and mock-deck-fixtures.ts sample apply URLs)." },
  "careers.adobe.com": { files: ["src/components/mock/AuthGateMock.tsx", "src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/)." },
  "linear.app": { files: ["src/components/mock/AuthGateMock.tsx", "src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/)." },
  "www.notion.so": { files: ["src/components/mock/AuthGateMock.tsx", "src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/)." },
  "www.careerplug.com": { files: ["src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/CompletenessMock.tsx:174)." },
  "tracegains.com": { files: ["src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/CompletenessMock.tsx:203)." },
  "www.figma.com": { files: ["src/components/mock/CompletenessMock.tsx"], reason: "sample apply URL inside mock demo data (src/components/mock/CompletenessMock.tsx:261)." },
  "velai.invalid": { files: ["src/components/ui/user-avatar.tsx"], reason: "src/components/ui/user-avatar.tsx:17: .invalid is a reserved name that never resolves (RFC 2606/6761), used only as a URL-parsing base to check a picture address and never requested." },
  "tailscale.com": { files: ["src/lib/legal/processors.ts"], reason: "src/lib/legal/processors.ts: the address of Tailscale's security page, quoted in the Tailscale row as the source of its encryption claims; only text, never requested." },
  "127.0.0.1": { files: ["src/app/mock/oauth-consent/page.tsx"], reason: "src/app/mock/oauth-consent/page.tsx:11: a sample redirect address on a mock consent screen." },
};
