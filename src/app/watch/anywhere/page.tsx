/**
 * D9: the phone-side half of the Tailscale upgrade.
 *
 * The agent sends this link (in chat, not as the watch link itself) after
 * the user replies `setup` to the one-time offer. Everything the phone
 * needs to do lives here as two plain steps — the laptop side (install
 * check, `tailscale up`, auth-URL scrape, marker file) is entirely the
 * agent's job, not this page's. Static: nothing here changes at runtime,
 * so there is no client-side state and no data to fetch.
 */
export default function WatchAnywherePage() {
    return (
        <main className="min-h-dvh bg-black text-white flex items-center justify-center p-6">
            <div className="max-w-sm space-y-6" data-testid="watch-anywhere-guide">
                <h1 className="text-lg font-medium">Watch from anywhere</h1>
                <p className="text-sm text-white/60">
                    Watch from anywhere runs over your own private network; nothing passes through
                    intervu.
                </p>
                <ol className="space-y-3 text-sm text-white/80 list-decimal list-inside">
                    <li>Install the Tailscale app on this device.</li>
                    <li>Sign in with the same account your agent shows you.</li>
                </ol>
                <p className="text-sm text-white/60">
                    Your agent walks you through it — reply <span className="text-white">setup</span> to
                    it whenever you&apos;re ready.
                </p>
            </div>
        </main>
    );
}
