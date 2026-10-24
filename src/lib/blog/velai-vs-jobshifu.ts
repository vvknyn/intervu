import type { BlogPost } from "./posts";
import { PRO_MONTHLY_PRICE } from "@/app/pricing/offer";

const DIR = "/blog/velai-vs-jobshifu";

/**
 * Side-by-side comparison of Velai and JobShifu (`https://jobshifu.com`),
 * checked on 2026-10-12 against Velai's live codebase and JobShifu's public
 * pages (`/pricing`, `/privacy`, `/blog/is-jobshifu-legit`,
 * `/blog/is-jobshifu-worth-it`, `/jobshifu-vs-hiringcafe`).
 *
 * Every claim about Velai is backed by live code:
 * - listings from employers' own career pages via Subspace, showing posted and
 *   first-seen dates and stale-posting checks (`Actively posted`, `Worth
 *   verifying`, `Possibly stale`).
 * - guest search without an account; Strong / Good / Stretch / Outside fit
 *   labels worked out in the browser by fixed rules (`lib/local-ai/`).
 * - tailoring rewords existing lines, blocks new numbers (`groundDraft`),
 *   starts posting-borrowed words off (`startsOn: false`), and downloads a
 *   one-page PDF in the uploaded PDF's own layout.
 * - Chrome extension (0.4.0) shows fit, posting checks and a one-page PDF, and
 *   `Fill from your résumé` fills basic contact/link fields and attaches the
 *   PDF without ever pressing Submit.
 * - résumé read in the browser, AES-256 encrypted when saved, and AI on
 *   Tinfoil's sealed server with name and contact stripped first (`/privacy`).
 * - prices from `app/pricing/offer.ts`.
 */
export const VELAI_VS_JOBSHIFU: BlogPost = {
    slug: "velai-vs-jobshifu",
    title: "Velai and JobShifu: how the two job tools compare",
    searchTitle: "Velai vs JobShifu: how the two job tools compare",
    description:
        "A side-by-side look at Velai and JobShifu on October 12, 2026: job sources, résumé tailoring, form filling, privacy, prices, and where each one fits.",
    datePublished: "2026-10-12",
    cover: `${DIR}/comparison.png`,
    images: {
        [`${DIR}/comparison.png`]: { width: 2400, height: 1260 },
    },
    body: `
Both Velai and [JobShifu](https://jobshifu.com) start from the same frustration: big job boards mix reposted ads with listings that closed weeks ago, and generic AI résumé tools invent skills you can't defend in an interview. Both read jobs straight from employers' own career pages and ATS boards, and both stop before the final Submit button so you send every application yourself.

From there, they take different shapes. JobShifu is a full AI application suite built around a career fact database it calls the Vault, a conversational assistant named Shifu, multi-page ATS autofill, and mobile apps. Velai is a smaller, privacy-first job search with rule-based fit labels, sealed-server tailoring that keeps your PDF's own layout, and a browser extension that fills basic contact fields and attaches your one-page PDF.

Here is what each one does today, read from Velai's live code and JobShifu's public pages on October 12, 2026.

![Side-by-side comparison of Velai and JobShifu across job search, résumé tailoring, form filling, privacy, and pricing as of October 12, 2026.](${DIR}/comparison.png)

## Where the jobs come from, and how you search

Both services pull listings from employers' own career pages and ATS boards (Workday, Greenhouse, Lever, Ashby and others), record when a posting was first seen, and check whether roles are still open.

- **Velai** gets its listings from [Subspace](https://thesubspace.io), shows both the employer's posted date and when our crawler first saw the role, and marks each posting Actively posted, Worth verifying or Possibly stale. You can [search without an account](/jobs). Search itself uses no AI. When you add a résumé, each role is marked **Strong**, **Good** or **Stretch** (or **Outside** your country when eligibility rules rule you out), worked out in your browser by fixed rules with the reasons shown beside the label.
- **JobShifu** crawls employer career sites directly ([their legit page](https://jobshifu.com/blog/is-jobshifu-legit)) and matches roles against your Vault using semantic embeddings (via Voyage AI, per [their privacy policy](https://jobshifu.com/privacy)) alongside filters for visa sponsorship, remote work and role level.

## Tailoring your résumé without making things up

Both tools are built around the rule that a tailored résumé shouldn't invent experience you don't have, and they enforce that rule differently:

- **JobShifu** builds a **Vault** of confirmed career facts in your account. When a job asks for a skill that isn't on your résumé, JobShifu asks whether you actually have it; if you confirm a real example, it saves that fact to your Vault for future roles. Its tailoring and 11-check calibration engine (using Anthropic's Claude) checks every line for Vault provenance and job-posting echo, then exports a single-column layout.
- **Velai** has no cross-résumé Vault and doesn't ask gap questions to grow your history. Instead, it rewords lines already on the résumé you uploaded, shows every change with its reason and an Undo button, blocks any new number that isn't on your résumé, and starts rewrites that borrow words from the posting switched off until you turn them on. When you download a PDF, Velai keeps the layout of the PDF you uploaded (your paper size, margins, serif or sans face, and type size), fitted to one page.

## Filling out applications and the Chrome extension

Neither tool submits applications behind your back. Both stop before the final Submit button so you review and send the application yourself.

- **JobShifu's Chrome extension** goes much further on form filling: it walks multi-page ATS flows (including Workday step-by-step wizards, Greenhouse, Lever and Ashby), dropdowns, work authorization and sponsorship questions, and custom screener questions using answers stored in your Vault.
- **Velai's Chrome extension** is narrower by design. On job boards, ATS pages and company career sites, it shows how the job fits your résumé, the posting checks, and a tailored one-page résumé. Pressing **Fill from your résumé** fills empty basic fields (your name, email, phone, location and links) from your résumé and attaches your tailored PDF, then marks the job Applied in your tracker when the employer's confirmation page appears. It does not walk multi-page Workday wizards, pick dropdowns, or write screener essays.

## What JobShifu has that Velai doesn't

If you want an all-in-one AI assistant around your job search, JobShifu builds several things Velai doesn't:

- **The Vault**, which remembers confirmed skills, stories and screener answers across applications so you answer each gap question once.
- **Cover letters, screener answers, and interview prep** generated from your Vault and the job posting, plus a **Shifu** chat assistant and skill-gap simulator.
- **Multi-page Workday and screener autofill** in its Chrome extension.
- **iOS and Android apps** alongside the web app. Velai is web and Chrome extension only, though you can connect your Velai account to Claude, ChatGPT or Cursor over [MCP](/connect).

## Privacy and where your résumé goes

- **Velai** reads your résumé file in your browser and never uploads the file itself. Unless you have a paid month, what Velai reads stays in that browser's local storage. With a paid month you can save it to your account, where it is encrypted with AES-256 in our database. When AI helps read or tailor your résumé, your name and contact details are taken out first, and the request runs on [Tinfoil](https://tinfoil.sh)'s hardware-attested sealed server, encrypted in your browser so our servers can't read it ([privacy policy](/privacy#your-resume)).
- **JobShifu** stores your master résumé and Vault in a Supabase database with row-level security ([JobShifu's privacy policy](https://jobshifu.com/privacy), read October 12, 2026). To run its Vault matching, tailoring and Shifu assistant, it sends relevant parts of your Vault and the job posting to **Anthropic (Claude)** and **Voyage AI**. Its privacy policy also notes that the résumé file you upload during setup is kept for 30 days so their team can help debug setup issues, and Shifu chat transcripts are kept for 90 days.

## What each one costs

- **JobShifu** ([pricing page](https://jobshifu.com/pricing), read October 12, 2026) has a free tier with no card required that includes job matches, application tracking, extension autofill (including Workday), 2 tailored résumés a day, 5 AI screener answers a week, 3 cover letters a month, 1 interview prep a month, and a 7-day trial of the full Shifu assistant. Unlimited **Pro** is **$29.99/month** ($74.99/quarter or $239.99/year), or a one-time **$14.99 Week Pass** for 7 days that never auto-renews.
- **Velai** ([pricing page](/pricing)) makes search and fit labels free, with no card and no trial clock, because they use no AI and cost very little to run. Saving your résumé to your account, tailoring and the other AI features need a paid month at **${PRO_MONTHLY_PRICE}/month**, bought 1 to 12 months at a time with one payment, no auto-renew and a 14-day refund.

## Which one to pick

- **Pick JobShifu** if you want a full AI copilot: a Vault that accumulates your career stories and screener answers over time, cover letters and interview prep in the same place, multi-page Workday autofill, or a mobile app, and you're comfortable sending your Vault data to Anthropic and Voyage AI (and paying $14.99/week or $29.99/month if you outgrow 2 tailored résumés a day).
- **Pick Velai** if you want to [search without an account](/jobs), see plain rule-based reasons why a role fits or is outside your country, keep your own PDF's typography and margins when tailoring, fill basic contact fields and attach your PDF without handing your résumé to an unsealed model provider, or pay nothing today.

Because both have free tiers that don't ask for a card, you can try both on the same job and see which workflow fits you better. If we've got any fact about JobShifu wrong here, or if something changed after October 12, 2026, [tell us](/contact) and we'll update this page.
`.trim(),
};
