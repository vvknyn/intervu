/**
 * The `/unsubscribe` and `/unsubscribe/undo` routes render plain HTML
 * directly (not a React page) — Next.js doesn't allow a `page.tsx` and a
 * `route.ts` to share one path, and RFC 8058's one-click unsubscribe
 * requires the SAME URL to answer both a human's GET (open the link,
 * see confirmation) and a mail client's automated POST. A `route.ts`-only
 * implementation is the only shape that supports both, so this is the one
 * place the confirmation page's markup lives — no React, no hydration, no
 * JS required even for the undo action (it's a plain HTML form POST).
 */
import { NextResponse } from "next/server";

import { EMAIL_COLORS as C, EMAIL_FONT_SANS, EMAIL_WORDMARK } from "./templates/palette";

/**
 * Styled from the email palette rather than the site's stylesheet: this route
 * returns a bare string, so there is no Tailwind build and no `globals.css`
 * to inherit from — the same constraint the emails have, and the reason the
 * page had drifted to unbranded `#111`/`#555`/`#ccc` greys that matched
 * neither the product nor the email that links here.
 */
export function renderUnsubscribeStatusPage(input: {
  title: string;
  message: string;
  undo?: { formAction: string };
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${input.title} — intervu</title>
  </head>
  <body style="font-family:${EMAIL_FONT_SANS};max-width:420px;margin:80px auto;padding:0 24px;background-color:${C.page};color:${C.ink};text-align:center;">
    <p style="margin:0 0 28px;font-size:${EMAIL_WORDMARK.fontSize}px;font-weight:${EMAIL_WORDMARK.fontWeight};letter-spacing:${EMAIL_WORDMARK.letterSpacing};text-transform:uppercase;">${EMAIL_WORDMARK.text}</p>
    <h1 style="font-size:20px;margin-bottom:12px;letter-spacing:-0.01em;">${input.title}</h1>
    <p style="color:${C.muted};font-size:14px;line-height:1.6;">${input.message}</p>
    ${
      input.undo
        ? `<form method="POST" action="${input.undo.formAction}" style="margin-top:24px;">
      <button type="submit" style="font:inherit;padding:10px 16px;border:1px solid ${C.line};border-radius:8px;background:${C.card};color:${C.ink};cursor:pointer;">Wasn't me &mdash; resubscribe</button>
    </form>`
        : ""
    }
  </body>
</html>`;
}

export function htmlPageResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
