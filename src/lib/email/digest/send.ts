/**
 * The digest's thin sender. `previewDigestForUser` does everything up to
 * "here's the exact email" without ever calling `sendEmail` or advancing
 * the cursor — that's what `scripts/digest-dry-run.mts` calls, so a dry
 * run is a real code path, not a separate reimplementation that could
 * silently drift from what actually gets sent.
 */
import { getAdminAuth } from "@/lib/firebase/admin";
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
 * Firebase Auth's email for a digest-eligible uid, or null when the account
 * has none. Shared by `previewDigestForUser` and the route's PG-lane dedupe
 * set (`sendEmailFollowDigests`'s `excludeEmails`) — one lookup, so the two
 * lanes can't drift on how "this account's email" is defined.
 */
export async function digestEmailForUid(uid: string): Promise<string | null> {
  const user = await getAdminAuth()
    .getUser(uid)
    .catch(() => null);
  return user?.email ?? null;
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
