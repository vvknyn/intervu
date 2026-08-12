import type { Metadata } from "next";
import Link from "next/link";
import { processUnsubscribeAction } from "@/actions/unsubscribe";
import { UndoUnsubscribeButton } from "@/components/unsubscribe/UndoUnsubscribeButton";
import type { UnsubscribeScope } from "@/lib/email/unsubscribe-token";

export const metadata: Metadata = {
    title: "Unsubscribe",
    robots: { index: false, follow: false },
};

const SCOPE_LABEL: Record<UnsubscribeScope, string> = {
    digest: "the weekly digest",
    waitlist_confirm: "waitlist confirmations",
    transactional: "account emails",
    all: "all intervu emails",
};

/**
 * GET /unsubscribe?token=… — no login required (the token itself proves
 * intent to unsubscribe THAT address, same trust model List-Unsubscribe
 * links use everywhere). Suppression happens on load, not behind a second
 * click — that's what "one-click unsubscribe" means. The undo button below
 * is the safety net for a mis-click, not a second confirmation gate.
 */
export default async function UnsubscribePage({
    searchParams,
}: {
    searchParams: Promise<{ token?: string }>;
}) {
    const { token } = await searchParams;

    if (!token) {
        return (
            <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
                <h1 className="font-display text-xl font-bold text-foreground">Unsubscribe</h1>
                <p className="mt-3 text-sm text-muted-foreground">
                    This link is missing its token. Use the unsubscribe link from the email itself, or{" "}
                    <Link href="/contact" className="underline text-brand hover:text-brand/80">
                        contact us
                    </Link>
                    .
                </p>
            </main>
        );
    }

    const result = await processUnsubscribeAction(token);

    if (!result.ok) {
        return (
            <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
                <h1 className="font-display text-xl font-bold text-foreground">Unsubscribe</h1>
                <p className="mt-3 text-sm text-muted-foreground">{result.error}</p>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
            <h1 className="font-display text-xl font-bold text-foreground">You&apos;re unsubscribed</h1>
            <p className="mt-3 text-sm text-muted-foreground">
                {result.email} won&apos;t get {SCOPE_LABEL[result.kind]} anymore. It took effect immediately.
            </p>
            <div className="mt-6 flex justify-center">
                <UndoUnsubscribeButton token={token} />
            </div>
        </main>
    );
}
