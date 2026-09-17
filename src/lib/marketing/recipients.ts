/**
 * Pure recipient-selection decision, no I/O — the send script resolves the
 * candidate list (WorkOS), the suppression set (Firestore
 * `email_suppressions`, scope "marketing_update") and the already-sent set
 * (Postgres `marketing_sends`) and passes them in here as plain
 * arrays/sets, so this is directly unit-testable without mocking either
 * store.
 */
import { normalizeEmail } from "@/lib/email/normalize-email";

export interface CampaignCandidate {
  userId: string;
  email: string;
  firstName: string | null;
}

export interface SelectCampaignRecipientsOptions {
  /** Normalized emails suppressed for this campaign's kind (or "all"). */
  suppressedEmails: Set<string>;
  /** user_ids `marketing_sends` already has a row for, for this campaign. */
  alreadySentUserIds: Set<string>;
}

export function selectCampaignRecipients(
  candidates: CampaignCandidate[],
  options: SelectCampaignRecipientsOptions,
): CampaignCandidate[] {
  return candidates.filter(
    (candidate) =>
      !options.alreadySentUserIds.has(candidate.userId) &&
      !options.suppressedEmails.has(normalizeEmail(candidate.email)),
  );
}
