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

export function renderUnsubscribeStatusPage(input: {
  title: string;
  message: string;
  undo?: { formAction: string };
}): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${input.title} — intervu</title>
  </head>
  <body style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:420px;margin:80px auto;padding:0 24px;color:#111;text-align:center;">
    <h1 style="font-size:20px;margin-bottom:12px;">${input.title}</h1>
    <p style="color:#555;font-size:14px;line-height:1.6;">${input.message}</p>
    ${
      input.undo
        ? `<form method="POST" action="${input.undo.formAction}" style="margin-top:24px;">
      <button type="submit" style="font:inherit;padding:10px 16px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">Wasn't me &mdash; resubscribe</button>
    </form>`
        : ""
    }
  </body>
</html>`;
}

export function htmlPageResponse(html: string, status = 200): NextResponse {
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
