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
export type EmailKind = "digest" | "waitlist_confirm" | "transactional";

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
  transactional: { suppressible: false, requiresUnsubscribeHeader: false },
};

export function emailKindPolicy(kind: EmailKind): EmailKindPolicy {
  return EMAIL_KIND_POLICY[kind];
}
