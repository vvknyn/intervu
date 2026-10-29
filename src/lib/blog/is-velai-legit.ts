import type { BlogPost } from "./posts";
import { BLOG_AUTHOR } from "./author";
import { PRO_MONTHLY_PRICE } from "@/app/pricing/offer";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

const DIR = "/blog/is-velai-legit";

/**
 * The trust page: what Velai is, who runs it, how it pays for itself, what it
 * won't do, and checks a reader can run themselves. Every claim is one the
 * site already makes and the code bears out, checked 2026-10-12:
 *
 * - listings from employers' own career pages, none invented, employers don't
 *   pay to be included: /about and /terms; no sponsored listings exist.
 * - the price and the 14-day refund: `app/pricing/offer.ts`, /pricing, /terms.
 * - tailoring can't add a number and starts posting words off: `groundDraft`
 *   and `startsOn` (lib/local-ai/tailor-ground.ts, tailor-resume.ts).
 * - AI on Tinfoil's attested server, name and contact out first, search and
 *   fit labels with no AI: /privacy (AI processing), lib/sealed-ai/client.ts.
 * - a guest's résumé lives only in that browser's local storage:
 *   lib/local-ai/resume-storage.ts, so a private window doesn't have it.
 * - both dates on a job: the posted and first-seen chips in JobDetail.tsx.
 * - self-serve deletion: ACCOUNT_SELF_SERVE_DELETION_FLOW and /privacy.
 *
 * Prices and the support address come from the modules that own them, so the
 * post can't drift from /pricing. tests/unit/blog-posts.test.ts checks the
 * button label it quotes. The founder signs the blog under the pen name in
 * `BLOG_AUTHOR` with a drawn avatar, and "Who runs it" says so plainly.
 */
export const IS_VELAI_LEGIT: BlogPost = {
    slug: "is-velai-legit",
    title: "Is Velai legit? What it is, who runs it, and how to check",
    searchTitle: "Is Velai legit? How to check it yourself",
    description:
        "A plain answer: what Velai is, who runs it, how it pays for itself, what it will never ask you for, and seven ways to check our claims yourself.",
    datePublished: "2026-10-12",
    cover: `${DIR}/checks.png`,
    images: {
        [`${DIR}/checks.png`]: { width: 2400, height: 1260 },
        [`${DIR}/privacy-promises.png`]: { width: 1436, height: 584 },
    },
    body: `
Yes. Velai is a job search that is free to use. It lists jobs from employers' own career pages, tells you how well each one fits your résumé and why, and, with a paid month, helps you tailor your résumé for the jobs you pick. It never asks you to pay to apply, and it never sends your résumé to an employer.

You shouldn't have to take our word for that. So this page says what Velai is, who runs it and how it pays for itself, then gives you seven checks you can run yourself in a few minutes.

![Seven things you can check about Velai yourself: search without an account, see that Apply opens the employer's own posting, check both dates on a job, see that your résumé stays in your browser, read why a job fits, look at every résumé change before you use it, and delete everything yourself.](${DIR}/checks.png)

## What Velai is

- **Job search.** Every listing comes from an employer's own careers site, read by our job data partner, Subspace. We don't invent listings, there are no sponsored listings, and employers don't pay to be included.
- **Fit.** Add your résumé and each job is marked Strong, Good or Stretch, with the reasons. A job you can't take, like one open only to U.S. citizens when you live in Canada, is marked Outside and moved to the end of the list.
- **Tailoring.** Pick a job and Velai rewords your résumé's own lines toward it, showing every change and why.
- **Tracking.** Save jobs, follow companies, keep track of where you applied, and get new matches by email.

Velai is in beta. It works, but it is still changing, and it still gets things wrong. There's more on that at the end.

## Who runs it

Velai is made by its founder and a small team. The job data comes from [Subspace](https://thesubspace.io), which reads employers' career pages and keeps track of when each posting appears, changes and closes.

The founder writes on this blog under the pen name ${BLOG_AUTHOR.name}, with a drawn picture rather than a photo, to keep their own name off the site without making up a fake employee. A person on the team reads every message sent through the [contact page](/contact) or to ${PUBLIC_SUPPORT_EMAIL}, and we answer from that address.

## How Velai pays for itself

Searching and matching are free, with no card and no trial clock. Search is ordinary search with no AI behind it, so a search costs us very little to run. That is what lets Velai stay free.

The parts that cost real money to run are paid, and there is one price, on the [pricing page](/pricing): ${PRO_MONTHLY_PRICE} a month, bought 1 to 12 months at a time. You pay once and it never renews on its own, unless you choose to pay month to month, which you can cancel any time. Either way a payment is refundable on request, for any reason, within 14 days. A paid month is what lets us save your résumé on your account and run AI on it; without one, your résumé stays on your device.

There are no ads, and nothing about you is sold.

## What Velai will never do

- Ask you to pay to see a job or to apply for one.
- Send your résumé to an employer, or apply on your behalf. You always apply on the employer's own site.
- Add experience you don't have. Tailoring rewords lines already on your résumé. It can't add a number that isn't there, and a rewrite that borrows words from the posting starts switched off until you turn it on.
- Make you sign up to search.
- Show you ads or sell your data.

## Where AI is used, and where it isn't

Velai uses AI for two things: reading your résumé when the quick read in your browser misses something, and rewording lines when you tailor your résumé for a job. Your name and contact details don't go to it. For reading they're taken out first, and for tailoring only the lines that match the job are sent.

That AI runs on [Tinfoil](https://tinfoil.sh)'s sealed server. Your browser first checks the server's hardware proof of the code it runs, then encrypts the request so only that server can read it. Our servers pass it on without being able to read it.

Search, the fit labels and the job emails use no AI. Strong, Good and Stretch are worked out in your browser by fixed rules.

Your résumé file is read in your browser and never uploaded. Unless you have a paid month, what Velai reads from it stays in that browser. With one, it's encrypted with AES-256 before it's saved to your account. The [privacy policy](/privacy#your-resume) has the details.

![Velai's four privacy promises, as shown on the privacy policy: read in your browser, encrypted when saved, AI sees only what it needs, and never sold.](${DIR}/privacy-promises.png)

## Seven ways to check it yourself

1. **Search without an account.** Open [Velai's job search](/jobs) and search for anything. There's no sign-up and no card.
2. **See where a job comes from.** Open any job and press **Apply on employer site**. It opens the employer's own posting, so you can see the role on the company's own site. Until you have a free account the button reads **Sign in to apply** and asks you to sign in first.
3. **Check the dates.** A job shows when the employer posted it and, where we have it, when our crawler first found it. A relisted job can carry a new date without being a new role, which is why we show both.
4. **See that your résumé stays in your browser.** Without signing in, add your résumé, then open Velai in a private window. Your résumé isn't there, because Velai keeps it only in the browser you added it in.
5. **Read why a job fits.** With your résumé added, each job says Strong, Good or Stretch and gives the reasons. If a reason is wrong, tell us.
6. **Look at every change before you use it.** Tailor your résumé for a job and you'll see each change with its reason, and you can undo any of them. Rewrites that bring in the posting's words start switched off.
7. **Delete everything.** In [account settings](/settings), the Account tab has Delete account. It removes your résumé, its saved versions, your tracked applications and your sign-in. It's a button, not a support ticket.

## How to tell a job scam from a job search tool

Job scams usually start with a fake job ad or a message from a "recruiter". The warning signs: they ask you to pay for training, equipment or an application fee; they want your Social Insurance or Social Security number or bank details before any interview; or they offer you a job after a chat over text. Velai never does any of these. We don't make job offers, and the only payments we take are the optional ones on the pricing page. The FTC has [a good guide to job scams](https://consumer.ftc.gov/articles/job-scams).

Because Velai lists jobs only from employers' own career sites, a fake ad posted to a job board doesn't show up here. It's still worth checking that **Apply on employer site** takes you to the company you expect.

## What we still get wrong

Velai is in beta, and it isn't always right. When we ran our [same-résumé test](/blog/same-resume-test-october-2026), we listed what went wrong on our side, like jobs labelled remote that weren't.

If you find something wrong, whether it's a closed job, a fit that makes no sense, or a claim on this page that doesn't hold up, [tell us](/contact). We read every message.
`.trim(),
};
