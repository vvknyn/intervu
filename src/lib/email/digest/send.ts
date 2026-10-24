/**
 * The digest's thin sender. `previewDigestForUser` does everything up to
 * "here's the exact email" without ever calling `sendEmail` or advancing
 * the cursor — that's what `scripts/digest-dry-run.mts` calls, so a dry
 * run is a real code path, not a separate reimplementation that could
 * silently drift from what actually gets sent.
 */
import { getWorkosUserManagement, resolveWorkosUserId, type WorkosUserManagement } from "@/lib/auth/workos-runtime";
import { isWorkosNotFound } from "@/lib/auth/workos-errors";
import { getSiteUrl } from "@/lib/seo/constants";
import { isMintedLoginEmail } from "@/lib/auth/username-email";
import { signUnsubscribeToken } from "../unsubscribe-token";
import { sendEmail, type SendEmailResult } from "../send";
import { buildDigestEmail } from "../templates/digest";
import { setDigestCursor } from "../digest-cursor";
import { collectDigestForUser } from "./collect";

export type DigestSkipReason = "no-email" | "no-mailbox" | "no-new-items" | "missing-unsubscribe-url";

export interface DigestPreview {
  email: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export type DigestPreviewResult = DigestPreview | { skipped: DigestSkipReason };

/**
 * WorkOS's email for a uid: the address, null when WorkOS says there is no
 * such account (or the record has no email), and a THROW on any other
 * failure. The lower-level lookup both wrappers below share, so the WorkOS
 * calls exist once.
 */
export async function workosEmailForUid(
  uid: string,
  injected?: Pick<WorkosUserManagement, "getUserByExternalId" | "getUser">,
): Promise<string | null> {
  try {
    const userManagement = injected ?? (await getWorkosUserManagement());
    const userId = await resolveWorkosUserId(
      (externalId) => userManagement.getUserByExternalId(externalId),
      uid,
    );
    return (await userManagement.getUser(userId)).email ?? null;
  } catch (err) {
    if (isWorkosNotFound(err)) return null;
    throw err;
  }
}

/**
 * The digest's view: the email for a digest-eligible uid, or null when the
 * account has none or the lookup failed (a missed digest retries tomorrow).
 * Shared by `previewDigestForUser` and the route's PG-lane dedupe set
 * (`sendEmailFollowDigests`'s `excludeEmails`) — one lookup, so the two
 * lanes can't drift on how "this account's email" is defined.
 */
export async function digestEmailForUid(uid: string): Promise<string | null> {
  try {
    return await workosEmailForUid(uid);
  } catch {
    return null;
  }
}

export async function previewDigestForUser(uid: string): Promise<DigestPreviewResult> {
  const email = await digestEmailForUid(uid);
  if (!email) return { skipped: "no-email" };
  // `sendEmail` refuses these anyway (`resolveSendPreflight` -> "no-mailbox"),
  // so this is cost, not correctness: collecting a digest is a Meilisearch
  // query per followed/tracked company plus one per saved search, and there
  // is no reason to spend that assembling an email for an address that has
  // no mailbox. A dry run on 2026-08-17 found a minted address at the top of
  // the eligible set doing exactly that.
  if (isMintedLoginEmail(email)) return { skipped: "no-mailbox" };

  const token = signUnsubscribeToken(email, "digest");
  if (!token) return { skipped: "missing-unsubscribe-url" };
  const unsubscribeUrl = `${getSiteUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;

  const model = await collectDigestForUser(uid, unsubscribeUrl);
  if (!model) return { skipped: "no-new-items" };

  return { email, unsubscribeUrl, ...buildDigestEmail(model) };
}

export type DigestSendResult = SendEmailResult | { sent: false; reason: DigestSkipReason };

export async function sendDigestForUser(uid: string): Promise<DigestSendResult> {
  const preview = await previewDigestForUser(uid);
  if ("skipped" in preview) return { sent: false, reason: preview.skipped };

  const result = await sendEmail({
    to: preview.email,
    subject: preview.subject,
    html: preview.html,
    text: preview.text,
    kind: "digest",
    unsubscribeUrl: preview.unsubscribeUrl,
  });

  if (result.sent) {
    await setDigestCursor(uid, new Date().toISOString());
  }
  return result;
}
