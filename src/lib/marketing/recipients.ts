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
  /** False when the person never confirmed the address; a send there may
   *  bounce or reach someone who didn't sign up. Unknown counts as confirmed. */
  emailVerified?: boolean;
  /** False for a WorkOS user not tagged for Velai (`metadata.apps`), such as
   *  a sign-up that never finished on Velai's side. Unknown counts as tagged. */
  velaiAccount?: boolean;
}

export interface SelectCampaignRecipientsOptions {
  /** Normalized emails suppressed for this campaign's kind (or "all"). */
  suppressedEmails: Set<string>;
  /** user_ids `marketing_sends` already has a row for, for this campaign. */
  alreadySentUserIds: Set<string>;
  /** When given, only these normalized emails are eligible (`--only`): the
   *  list someone reviewed, so an account made since, or one left out on
   *  purpose, is not sent to. */
  onlyEmails?: Set<string>;
  /** `--include-unverified` / `--include-untagged`: also send to listed
   *  addresses WorkOS has as never verified, or not tagged for Velai. Only
   *  with `onlyEmails`, so each one was named by whoever runs the send. */
  includeUnverified?: boolean;
  includeUntagged?: boolean;
}

export function selectCampaignRecipients(
  candidates: CampaignCandidate[],
  options: SelectCampaignRecipientsOptions,
): CampaignCandidate[] {
  if ((options.includeUnverified || options.includeUntagged) && !options.onlyEmails) {
    throw new Error("--include-unverified and --include-untagged need an --only list of the addresses to send to");
  }
  return candidates.filter(
    (candidate) =>
      (candidate.emailVerified !== false || options.includeUnverified === true) &&
      (candidate.velaiAccount !== false || options.includeUntagged === true) &&
      !options.alreadySentUserIds.has(candidate.userId) &&
      !options.suppressedEmails.has(normalizeEmail(candidate.email)) &&
      (!options.onlyEmails || options.onlyEmails.has(normalizeEmail(candidate.email))),
  );
}

/**
 * The `--only` file: one address per line, `#` starts a comment. Anything
 * else on a line (a CSV row, a name) is refused rather than guessed at, so a
 * spreadsheet export with a "send: no" column can't be passed by mistake.
 */
export function parseOnlyList(raw: string): Set<string> {
  const emails = new Set<string>();
  raw.split(/\r?\n/).forEach((line, i) => {
    const entry = line.replace(/#.*/, "").trim();
    if (!entry) return;
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(entry)) {
      throw new Error(`--only list line ${i + 1} is not a single email address: "${entry.slice(0, 60)}"`);
    }
    emails.add(normalizeEmail(entry));
  });
  if (emails.size === 0) throw new Error("--only list has no addresses");
  return emails;
}
