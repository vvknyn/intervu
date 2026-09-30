/**
 * The founding-seat offer on /pricing — the one place its numbers and the
 * Stripe Payment Link mechanics live, so the page, the terms and the tests
 * read the same figures.
 *
 * Why a Payment Link and not Stripe Checkout: this is a willingness-to-pay
 * test, not a billing system. A Payment Link is a hosted page Stripe owns
 * end to end (card entry, receipts, refunds, tax), created in the Stripe
 * dashboard with no server code and no webhook. Velai only needs to (1)
 * send the visitor there with enough context to tie a purchase back to an
 * account, and (2) notice them coming back. Both are query parameters.
 *
 * `client_reference_id` and `prefilled_email` are the two parameters a
 * Payment Link accepts on its URL (Stripe docs: "Customize payment links").
 * `client_reference_id` is limited to letters, digits, `-` and `_`, at most
 * 200 characters — every Velai uid (Firebase or WorkOS) already fits that
 * alphabet, and anything that doesn't is dropped rather than sent, since an
 * invalid value makes Stripe reject the whole link.
 *
 * The link's after-payment redirect is configured in the dashboard as
 * `<site>/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
 * `paidCheckoutSessionId` is the matching reader. It is a display and
 * analytics signal only — Stripe's dashboard is the ledger. Nothing on the
 * account changes on return, by design: there is no Pro to switch on yet.
 */

export const FOUNDING_SEAT_PRICE = "$49";
export const FOUNDING_SEAT_COUNT = 100;
export const PRO_MONTHLY_PRICE = "$12";
export const DATA_API_FROM_PRICE = "$49";

/** Server-only env var holding the Stripe Payment Link for a founding seat.
 *  Unset (the default, and the state on every deploy until Vivek creates the
 *  link) renders the "opening soon" state — the page never guesses a URL. */
export const FOUNDING_CHECKOUT_URL_ENV = "FOUNDING_MEMBER_CHECKOUT_URL";

/** Server-only env var holding the Stripe Payment Link for the pay-it-forward
 *  pledge shown on a tracker pursuit in the Offer lane (strategy decision 7,
 *  2026-09-29). A pay-what-you-want link with the suggested amount preset,
 *  so the panel's copy and the link agree. Unset, the panel asks how it went
 *  and links to the contact page instead; it never guesses a URL. */
export const LANDED_PLEDGE_URL_ENV = "LANDED_PLEDGE_CHECKOUT_URL";
/** What the pledge panel suggests; the link lets the person change it. */
export const LANDED_PLEDGE_SUGGESTED = "$99";

/** What the reservation confirmation email says the address signed up for
 *  ("You're on the list — a founding seat on Velai Pro"). */
export const FOUNDING_WAITLIST_LABEL = "a founding seat on Velai Pro";

const CLIENT_REFERENCE_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

/** A Stripe checkout session id, as the after-payment redirect hands it back
 *  (`cs_live_…` / `cs_test_…`). Bounded so a hand-typed query string never
 *  lands in an analytics property as-is. */
const CHECKOUT_SESSION_ID_RE = /^cs_(?:live|test)_[A-Za-z0-9]{1,120}$/;

export type FoundingBuyer = { uid: string; email?: string } | null;

/**
 * The URL the founding-seat button sends a visitor to, or `null` when the
 * offer is not configured. `base` is the raw env var value; anything that is
 * not an absolute `https:` URL is treated as unset, so a typo in the env
 * file degrades to "opening soon" rather than a button that 404s on Stripe.
 */
export function checkoutUrlWithBuyer(base: string | undefined, buyer: FoundingBuyer): string | null {
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (buyer) {
    if (CLIENT_REFERENCE_ID_RE.test(buyer.uid)) url.searchParams.set("client_reference_id", buyer.uid);
    if (buyer.email) url.searchParams.set("prefilled_email", buyer.email);
  }
  return url.toString();
}

/**
 * The checkout session id from a Stripe return, or `null` for any other
 * visit. Requires BOTH `checkout=success` and a well-formed `session_id`, so
 * `/pricing?checkout=success` alone (shared, bookmarked, guessed) never shows
 * the thank-you or fires `founding_member_paid`.
 */
/** The founding seat's link, and the name the pricing page and its tests
 *  use; the pledge panel's link is built the same way (`checkoutUrlWithBuyer`). */
export const foundingCheckoutUrl = checkoutUrlWithBuyer;

export function paidCheckoutSessionId(params: {
  checkout?: string | string[];
  session_id?: string | string[];
}): string | null {
  if (params.checkout !== "success") return null;
  const id = params.session_id;
  if (typeof id !== "string" || !CHECKOUT_SESSION_ID_RE.test(id)) return null;
  return id;
}

/**
 * The page's one-line description (meta, Open Graph, Twitter). Keyed on the
 * same switch as the founding button so search results and link previews
 * never promise seats the page withholds: release 8 fixed the headline and
 * badge but left a static description saying "open now" over an inert button.
 */
export function pricingDescription(foundingAvailable: boolean): string {
  return foundingAvailable
    ? "Velai is free to use. Pro and a Data API are coming; founding seats are open now at a one-off price."
    : "Velai is free to use. Pro and a Data API are coming; founding seats open soon at a one-off price, and you can reserve one now.";
}
