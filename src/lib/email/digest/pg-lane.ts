/**
 * The digest's second recipient lane: verified email-only identities with
 * active company follows and/or email saved searches. Reuses the same
 * listNewRolesForFollows / listNewRolesForSavedSearch chokepoints and the
 * same section mapping as collect.ts so lanes cannot drift.
 */
import {
  listEmailDigestRecipients,
  type EmailDigestRecipient,
} from "@/lib/identity/store";
import { listNewRolesForFollows, type FollowTarget } from "@/lib/follows/list-new-roles";
import { listNewRolesForSavedSearch, JOBS_FETCHED_PER_SAVED_SEARCH } from "@/lib/jobs/saved-search-new-roles";
import { jobsUrlStateFromSearchAlertHref } from "@/lib/identity/validate-search-href";
import { domainToSlug } from "@/lib/boards/slug";
import { getSiteUrl } from "@/lib/seo/constants";
import type { Queryable } from "@/lib/pg/pool";
import { companyGroupsToSections, toSectionItem } from "./collect";
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
  listRecipients(q: Queryable): ReturnType<typeof listEmailDigestRecipients>;
  listNewRolesForFollows(sinceIso: string, follows: FollowTarget[]): ReturnType<typeof listNewRolesForFollows>;
  listNewRolesForSavedSearch(
    sinceIso: string,
    state: ReturnType<typeof jobsUrlStateFromSearchAlertHref>,
  ): ReturnType<typeof listNewRolesForSavedSearch>;
  isEmailSuppressed(email: string): Promise<boolean>;
  signToken(email: string): string | null;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

const defaultDeps: SendEmailFollowDigestsDeps = {
  listRecipients: listEmailDigestRecipients,
  listNewRolesForFollows: listNewRolesForFollows,
  listNewRolesForSavedSearch: listNewRolesForSavedSearch,
  isEmailSuppressed: (email) => isSuppressed(email, "digest"),
  signToken: (email) => signUnsubscribeToken(email, "digest"),
  send: sendEmail,
};

export async function buildDigestSectionsForRecipient(
  input: { sinceIso: string; recipient: EmailDigestRecipient; siteUrl: string },
  deps: Pick<
    SendEmailFollowDigestsDeps,
    "listNewRolesForFollows" | "listNewRolesForSavedSearch"
  >,
): Promise<RawDigestSection[]> {
  const sections: RawDigestSection[] = [];

  if (input.recipient.follows.length > 0) {
    const follows: FollowTarget[] = input.recipient.follows.map((f) => ({
      domain: f.domain,
      displayName: f.displayName,
    }));
    const groups = await deps.listNewRolesForFollows(input.sinceIso, follows);
    sections.push(
      ...companyGroupsToSections({
        groups,
        kind: "followed-company",
        slugForDomain: domainToSlug,
        siteUrl: input.siteUrl,
      }),
    );
  }

  for (const search of input.recipient.savedSearches) {
    const state = jobsUrlStateFromSearchAlertHref(search.href);
    const jobs = await deps.listNewRolesForSavedSearch(input.sinceIso, state);
    sections.push({
      kind: "saved-search",
      name: search.name,
      items: jobs.map((job) => toSectionItem(job, input.siteUrl)),
      mayHaveMore: jobs.length >= JOBS_FETCHED_PER_SAVED_SEARCH,
      seeAllHref: `${input.siteUrl}${search.href}`,
    });
  }

  return sections;
}

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

      const token = deps.signToken(email);
      if (!token) return { email, result: "error" as const };
      const unsubscribeUrl = `${siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;

      const sections = await buildDigestSectionsForRecipient(
        { sinceIso: input.sinceIso, recipient, siteUrl },
        deps,
      );

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
