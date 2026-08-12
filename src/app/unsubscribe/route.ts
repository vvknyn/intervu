/**
 * GET/POST /unsubscribe?token=… — no login required (the token itself
 * proves intent to unsubscribe THAT address, same trust model every
 * List-Unsubscribe link uses). GET is the human path: open the link,
 * suppression happens on load (one click, no second confirmation gate),
 * see a plain confirmation with an undo. POST is RFC 8058: what the
 * `List-Unsubscribe-Post` header (send.ts) promises — mail clients with an
 * automated one-click "Unsubscribe" button (Gmail, most others) POST here
 * directly, same URL, no page render, no human in the loop.
 */
import { NextResponse } from "next/server";
import { processUnsubscribeAction } from "@/actions/unsubscribe";
import { renderUnsubscribeStatusPage, htmlPageResponse } from "@/lib/email/unsubscribe-page-html";
import type { UnsubscribeScope } from "@/lib/email/unsubscribe-token";

const SCOPE_LABEL: Record<UnsubscribeScope, string> = {
    digest: "the weekly digest",
    waitlist_confirm: "waitlist confirmations",
    transactional: "account emails",
    all: "all intervu emails",
};

export async function GET(request: Request): Promise<NextResponse> {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
        return htmlPageResponse(
            renderUnsubscribeStatusPage({
                title: "Unsubscribe",
                message: "This link is missing its token. Use the unsubscribe link from the email itself, or contact us.",
            }),
        );
    }

    const result = await processUnsubscribeAction(token);
    if (!result.ok) {
        return htmlPageResponse(renderUnsubscribeStatusPage({ title: "Unsubscribe", message: result.error }));
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
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
        return NextResponse.json({ error: "missing token" }, { status: 400 });
    }

    const result = await processUnsubscribeAction(token);
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ unsubscribed: true });
}
