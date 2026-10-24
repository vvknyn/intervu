/**
 * Every cookie Velai sets, as /privacy lists them. One list: the page renders
 * it, and tests/unit/privacy-cookies-disclosed.test.ts fails when a cookie name
 * set anywhere in src (or by AuthKit) is not in it.
 *
 * `wos-session` and `wos-auth-verifier` are set by the WorkOS AuthKit package,
 * not by our code; the test reads their names from the installed package.
 * The browser analytics SDK sets no cookie (posthog-options.ts: persistence
 * "sessionStorage").
 */
export interface DisclosedCookie {
  name: string;
  purpose: string;
  lifetime: string;
}

export const COOKIES_DISCLOSED: readonly DisclosedCookie[] = [
  {
    name: "wos-session",
    purpose: "Keeps you signed in. HttpOnly, so page scripts cannot read it; it holds your sealed session, nothing else.",
    lifetime: "Up to 400 days, or until you sign out",
  },
  {
    name: "wos-auth-verifier",
    purpose: "Set while you are sent to sign in, to check that the sign-in coming back is the one you started. HttpOnly.",
    lifetime: "10 minutes",
  },
  {
    name: "intervu_email_code",
    purpose: "Holds the sign-in in progress while you type the code we emailed you, sealed so only our server can open it. HttpOnly, sent only to /auth.",
    lifetime: "10 minutes, or until the code is accepted",
  },
  {
    name: "intervu_signup_completed",
    purpose: "Tells the page you just finished creating an account (it contains only how: email, google, username or passkey), so one sign-up is counted once. Cleared as soon as it is read.",
    lifetime: "5 minutes",
  },
  {
    name: "intervu_contact",
    purpose: "Remembers the address you confirmed from an email link so a follow or unfollow works in one click on this browser. Holds a random token, not the address. HttpOnly.",
    lifetime: "180 days",
  },
  {
    name: "sb_jobs_visitor",
    purpose: "A returning-visitor flag (literally the value 1, no identifier) so the front door can skip the first-visit intro.",
    lifetime: "30 days",
  },
];
