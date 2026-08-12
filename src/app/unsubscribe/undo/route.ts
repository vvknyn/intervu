/**
 * POST /unsubscribe/undo?token=… — the confirmation page's "wasn't me"
 * button. Plain HTML `<form method="POST">`, no JS required — matches
 * `/unsubscribe` itself being a no-hydration route handler, not a React
 * page (see that route's doc comment for why).
 */
import { NextResponse } from "next/server";
import { undoUnsubscribeAction } from "@/actions/unsubscribe";
import { renderUnsubscribeStatusPage, htmlPageResponse } from "@/lib/email/unsubscribe-page-html";

export async function POST(request: Request): Promise<NextResponse> {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) {
        return htmlPageResponse(
            renderUnsubscribeStatusPage({ title: "Unsubscribe", message: "This link is missing its token." }),
        );
    }

    const result = await undoUnsubscribeAction(token);
    if (!result.ok) {
        return htmlPageResponse(renderUnsubscribeStatusPage({ title: "Unsubscribe", message: result.error }));
    }

    return htmlPageResponse(
        renderUnsubscribeStatusPage({
            title: "You're back on the list",
            message: `${result.email} will get emails again. That took effect immediately too.`,
        }),
    );
}
