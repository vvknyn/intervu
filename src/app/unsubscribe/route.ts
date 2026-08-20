/**
 * GET/POST /unsubscribe?token=… — no login required (the token itself
 * proves intent to unsubscribe THAT address, same trust model every
 * List-Unsubscribe link uses). GET is the human path: open the link,
 * suppression happens on load (one click, no second confirmation gate),
 * see a plain confirmation with an undo. POST is RFC 8058: what the
 * `List-Unsubscribe-Post` header (send.ts) promises — mail clients with an
 * automated one-click "Unsubscribe" button (Gmail, most others) POST here
 * directly, same URL, no page render, no human in the loop.
 *
 * `?forget=1` is the forget-me variant on this SAME token flow (no new
 * auth surface) — see `processForgetAction`. It deletes rather than just
 * suppresses, so it never offers the "wasn't me" undo a plain unsubscribe
 * does.
 */
import { NextResponse } from "next/server";
import { processUnsubscribeAction, processForgetAction } from "@/actions/unsubscribe";
import { renderUnsubscribeStatusPage, htmlPageResponse } from "@/lib/email/unsubscribe-page-html";
import type { UnsubscribeScope } from "@/lib/email/unsubscribe-token";

const SCOPE_LABEL: Record<UnsubscribeScope, string> = {
    digest: "the weekly digest",
    waitlist_confirm: "waitlist confirmations",
    // Unreachable from the welcome email's own footer, which deliberately
    // signs an "all"-scoped token instead (see lib/email/welcome.ts — a
    // kind-scoped opt-out on a one-shot email would silently leave the
    // digest running). Required all the same: `UnsubscribeScope` covers
    // every `EmailKind`, and this Record is what makes a new kind a compile
    // error here rather than an empty sentence on the confirmation page.
    welcome: "introduction emails",
    transactional: "account emails",
    // Also unreachable in practice today (verify_follow is non-suppressible,
    // see EMAIL_KIND_POLICY in email/types.ts) — kept for the same reason
    // `welcome` is: a future caller signing a verify_follow-scoped token
    // must not land on an empty sentence here.
    verify_follow: "follow confirmation emails",
    all: "all intervu emails",
};

export async function GET(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const forget = url.searchParams.get("forget") === "1";
    if (!token) {
        return htmlPageResponse(
            renderUnsubscribeStatusPage({
                title: "Unsubscribe",
                message: "This link is missing its token. Use the unsubscribe link from the email itself, or contact us.",
            }),
        );
    }

    const result = forget ? await processForgetAction(token) : await processUnsubscribeAction(token);
    if (!result.ok) {
        return htmlPageResponse(renderUnsubscribeStatusPage({ title: "Unsubscribe", message: result.error }));
    }

    if (forget) {
        return htmlPageResponse(
            renderUnsubscribeStatusPage({
                title: "Your data has been deleted",
                message: `${result.email} and everything tied to it has been deleted. It took effect immediately.`,
            }),
        );
    }

    return htmlPageResponse(
        renderUnsubscribeStatusPage({
            title: "You're unsubscribed",
            message: `${result.email} won't get ${SCOPE_LABEL[result.kind]} anymore. It took effect immediately.`,
            undo: { formAction: `/unsubscribe/undo?token=${encodeURIComponent(token)}` },
        }),
    );
}

export async function POST(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const forget = url.searchParams.get("forget") === "1";
    if (!token) {
        return NextResponse.json({ error: "missing token" }, { status: 400 });
    }

    const result = forget ? await processForgetAction(token) : await processUnsubscribeAction(token);
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(forget ? { forgotten: true } : { unsubscribed: true });
}
