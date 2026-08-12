/**
 * The digest's thin sender. `previewDigestForUser` does everything up to
 * "here's the exact email" without ever calling `sendEmail` or advancing
 * the cursor — that's what `scripts/digest-dry-run.mjs` calls, so a dry
 * run is a real code path, not a separate reimplementation that could
 * silently drift from what actually gets sent.
 */
import { getAdminAuth } from "@/lib/firebase/admin";
import { getSiteUrl } from "@/lib/seo/constants";
import { signUnsubscribeToken } from "../unsubscribe-token";
import { sendEmail, type SendEmailResult } from "../send";
import { buildDigestEmail } from "../templates/digest";
import { setDigestCursor } from "../digest-cursor";
import { collectDigestForUser } from "./collect";

export type DigestSkipReason = "no-email" | "no-new-items" | "missing-unsubscribe-url";

export interface DigestPreview {
  email: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export type DigestPreviewResult = DigestPreview | { skipped: DigestSkipReason };

export async function previewDigestForUser(uid: string): Promise<DigestPreviewResult> {
  const user = await getAdminAuth()
    .getUser(uid)
    .catch(() => null);
  const email = user?.email;
  if (!email) return { skipped: "no-email" };

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
