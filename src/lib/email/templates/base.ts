/**
 * The one HTML/text shell every non-transactional template wraps its body
 * in — the unsubscribe footer lives here ONCE rather than being pasted into
 * each template file, so it can never drift between the digest and the
 * waitlist confirmation (or a future kind).
 */
export function renderEmailShellHtml(bodyHtml: string, unsubscribeUrl: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.5;">
    ${bodyHtml}
    <hr style="margin-top:32px;border:none;border-top:1px solid #e5e5e5;" />
    <p style="font-size:12px;color:#888;margin-top:16px;">
      <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a> from this at any time — it takes effect immediately.
    </p>
  </body>
</html>`;
}

export function renderEmailShellText(bodyText: string, unsubscribeUrl: string): string {
  return `${bodyText}\n\n---\nUnsubscribe (takes effect immediately): ${unsubscribeUrl}`;
}
