/**
 * POST /unsubscribe?token=… — RFC 8058 one-click unsubscribe. This is what
 * the `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header (sent on
 * every non-transactional email, see send.ts) promises support for: mail
 * clients with a one-click "Unsubscribe" button (Gmail, most others) POST
 * here directly, body `List-Unsubscribe=One-Click`, no page render, no
 * human in the loop. Coexists with `page.tsx`'s GET in the same route
 * segment — Next.js dispatches by method, GET stays with the page.
 */
import { NextResponse } from "next/server";
import { processUnsubscribeAction } from "@/actions/unsubscribe";

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
