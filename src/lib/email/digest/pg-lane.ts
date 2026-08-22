/**
 * The digest's second recipient lane: verified email-only identities (no
 * Firebase account) with at least one active `email_follows` row. Reuses
 * the same `listNewRolesForFollows` chokepoint and the same
 * `companyGroupsToSections` mapping `collect.ts` (the Firebase-account
 * lane) uses, so the two lanes can never drift on what counts as "new" or
 * on how a followed company renders in the email.
 *
 * There is no PG-side "since I last digested this identity" cursor — the
 * schema (Task 1) carries none, unlike the account lane's
 * `email_digest_state/{uid}` Firestore doc — so every run uses the single
 * `sinceIso` boundary the caller passes in (the route computes it the same
 * way `getDigestCursor` derives a first-run default: see route.ts).
 *
 * Deps-injected core, same shape as `submitFollowEmail` /
 * `followByContactCookie`: the required `{ q, sinceIso, excludeEmails }`
 * input matches the plan's public contract, and the optional second `deps`
 * argument (defaulted to the real store/search/suppression/send/token
 * seams) is what makes "suppressed recipient never reaches send" etc.
 * directly unit-testable without Firestore or a network call.
 */
import { listEmailFollowRecipients } from "@/lib/identity/store";
import { listNewRolesForFollows, type FollowTarget } from "@/lib/follows/list-new-roles";
import { domainToSlug } from "@/lib/boards/slug";
import { getSiteUrl } from "@/lib/seo/constants";
import type { Queryable } from "@/lib/pg/pool";
import { companyGroupsToSections } from "./collect";
import { assembleDigest, type RawDigestSection } from "./assemble";
import { buildDigestEmail } from "../templates/digest";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "../send";
import { isSuppressed } from "../suppression";
import { signUnsubscribeToken } from "../unsubscribe-token";
import { normalizeEmail } from "../normalize-email";

export type EmailFollowDigestResult =
  | "sent"
  | "skipped-excluded"
  | "skipped-suppressed"
  | "skipped-empty"
  | "error";

export interface SendEmailFollowDigestsDeps {
  listRecipients(q: Queryable): ReturnType<typeof listEmailFollowRecipients>;
  listNewRoles(sinceIso: string, follows: FollowTarget[]): ReturnType<typeof listNewRolesForFollows>;
  isEmailSuppressed(email: string): Promise<boolean>;
  signToken(email: string): string | null;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

const defaultDeps: SendEmailFollowDigestsDeps = {
  listRecipients: listEmailFollowRecipients,
  listNewRoles: listNewRolesForFollows,
  isEmailSuppressed: (email) => isSuppressed(email, "digest"),
  signToken: (email) => signUnsubscribeToken(email, "digest"),
  send: sendEmail,
};

export async function sendEmailFollowDigests(
  input: { q: Queryable; sinceIso: string; excludeEmails: Set<string> },
  deps: SendEmailFollowDigestsDeps = defaultDeps,
): Promise<Array<{ email: string; result: EmailFollowDigestResult }>> {
  const recipients = await deps.listRecipients(input.q);
  const siteUrl = getSiteUrl();

  return Promise.all(
    recipients.map(async (recipient) => {
      const email = normalizeEmail(recipient.email);
      if (input.excludeEmails.has(email)) return { email, result: "skipped-excluded" as const };
      if (await deps.isEmailSuppressed(email)) return { email, result: "skipped-suppressed" as const };

      // Signed before the search: a token failure (no ENCRYPTION_KEY) means
      // this recipient can never get a compliant send this run regardless
      // of what's new, so there is no reason to spend a Meilisearch call
      // per followed domain first — same cost-before-correctness ordering
      // `previewDigestForUser` uses for its own unsubscribe-token check.
      const token = deps.signToken(email);
      if (!token) return { email, result: "error" as const };
      const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

      const follows: FollowTarget[] = recipient.follows.map((f) => ({ domain: f.domain, displayName: f.displayName }));
      const groups = await deps.listNewRoles(input.sinceIso, follows);
      const sections: RawDigestSection[] = companyGroupsToSections({
        groups,
        kind: "followed-company",
        slugForDomain: domainToSlug,
        siteUrl,
      });

      const model = assembleDigest({ sections, unsubscribeUrl, siteUrl });
      if (!model) return { email, result: "skipped-empty" as const };

      const built = buildDigestEmail(model);
      const sendResult = await deps.send({
        to: email,
        subject: built.subject,
        html: built.html,
        text: built.text,
        kind: "digest",
        unsubscribeUrl,
      });

      return { email, result: sendResult.sent ? ("sent" as const) : ("error" as const) };
    }),
  );
}
