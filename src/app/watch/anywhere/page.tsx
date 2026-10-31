import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageTitle } from "@/components/ui/heading";

// Overrides the parent watch/layout.tsx title ("Live Application Session"),
// which is written for /watch/[id] and is wrong for this page.
export const metadata: Metadata = {
    title: "Watch from anywhere",
};

/**
 * D9: the phone-side half of the Tailscale upgrade.
 *
 * The agent sends this link (in chat, not as the watch link itself) after
 * the user replies `setup` to the one-time offer. Everything the phone
 * needs to do lives here as two plain steps — the laptop side (install
 * check, `tailscale up`, auth-URL scrape, marker file) is entirely the
 * agent's job, not this page's. Static: nothing here changes at runtime,
 * so there is no client-side state and no data to fetch.
 *
 * Not dead code: this page has zero inbound links anywhere in src/, which
 * reads as an orphan to a grep, but the URL travels out-of-band in the
 * agent's own WhatsApp messages (D2, 2026-08-26 redesign). Deleting or
 * folding it into /connect/help would break links already sent to a real
 * phone.
 */
export default function WatchAnywherePage() {
    return (
        <PageContainer measure="reading" className="page-top pb-16">
            <div className="max-w-sm space-y-6" data-testid="watch-anywhere-guide">
                <PageTitle>Watch from anywhere</PageTitle>
                <p className="text-sm text-muted-foreground">
                    Watch from anywhere runs over your own private network; nothing passes through
                    velai.
                </p>
                <ol className="space-y-2 text-sm text-foreground list-decimal list-inside">
                    <li>Install the Tailscale app on this device.</li>
                    <li>Sign in with the same account your agent shows you.</li>
                </ol>
                <p className="text-sm text-muted-foreground">
                    Your agent walks you through it — reply <span className="font-semibold text-foreground">setup</span> to
                    it whenever you&apos;re ready.
                </p>
            </div>
        </PageContainer>
    );
}
