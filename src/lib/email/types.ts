/**
 * Every email kind intervu can send is registered here, with its own
 * opt-in + unsubscribe semantics attached. This is the chokepoint E1's
 * `sendEmail` reads to decide whether a suppression check and a
 * List-Unsubscribe header are required — it dispatches on the policy
 * object, never on the kind string itself, so a future kind (e.g. a
 * "your application was viewed" notification) is covered the moment it's
 * added to `EMAIL_KIND_POLICY` below, not by editing an if/else ladder in
 * send.ts.
 */
export type EmailKind = "digest" | "waitlist_confirm" | "welcome" | "transactional" | "verify_follow";

export interface EmailKindPolicy {
  /** Checked against `email_suppressions` before every send. False only for
   *  kinds that are genuinely transactional (no commercial content, nothing
   *  to opt out of) — CASL/CAN-SPAM don't require (or permit blocking) those
   *  on an unsubscribe. */
  suppressible: boolean;
  /** Whether this kind must carry List-Unsubscribe/List-Unsubscribe-Post
   *  headers and a footer link. True for anything `suppressible` — the two
   *  travel together by construction (see `emailKindPolicy`'s invariant
   *  check, unsubscribe-token.test.ts). */
  requiresUnsubscribeHeader: boolean;
}

const EMAIL_KIND_POLICY: Record<EmailKind, EmailKindPolicy> = {
  digest: { suppressible: true, requiresUnsubscribeHeader: true },
  waitlist_confirm: { suppressible: true, requiresUnsubscribeHeader: true },
  // Suppressible even though it is triggered by the user's own first
  // sign-in. A welcome email that describes what the product does is
  // promotional content by every definition CAN-SPAM/CASL use, and someone
  // who has already unsubscribed from "all" must not receive one because it
  // happened to be classed as a courtesy. The honest test is what the email
  // CONTAINS, not what triggered it.
  welcome: { suppressible: true, requiresUnsubscribeHeader: true },
  transactional: { suppressible: false, requiresUnsubscribeHeader: false },
  // Confirms a single action the visitor just took on our own form (verified
  // email follow) — not commercial content, so nothing to opt out of, same
  // as `transactional`. Kept as its own kind (rather than reused as
  // "transactional") so send.ts's logging and any future suppression carve
  // out stay legible per-kind.
  verify_follow: { suppressible: false, requiresUnsubscribeHeader: false },
};

export function emailKindPolicy(kind: EmailKind): EmailKindPolicy {
  return EMAIL_KIND_POLICY[kind];
}
