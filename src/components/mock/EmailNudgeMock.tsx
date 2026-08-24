"use client";

/**
 * Every state of the account-email prompt on one page.
 *
 * The real surfaces are unreachable for a screenshot: both are auth-gated, and
 * the population they serve is accounts whose ONLY address is a minted
 * `<username>@intervu.cc` — so verifying them for real means creating a legacy
 * account, not just signing in. This renders the same component the settings
 * page and the /jobs banner render, in the same two framings, so the pixels
 * being checked are the shipped ones.
 *
 * `reachable` is included deliberately: it must render NOTHING. A state that
 * disappears is easy to break into a state that shows an empty box, and that
 * failure is invisible unless something asks for it on purpose.
 */
import { AccountEmailPrompt } from "@/components/account/AccountEmailPrompt";

function Case({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
    return (
        <section className="border border-border bg-card p-5">
            {/* Not font-mono: tests/unit/typography-mono.test.ts reserves
                monospace for <code>, and a fixture must not be the thing that
                grows that list. */}
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
            <p className="mt-1 mb-4 text-[12px] text-muted-foreground">{note}</p>
            <div className="border-t border-dashed border-border pt-4">{children}</div>
        </section>
    );
}

export function EmailNudgeMock() {
    return (
        <main className="mx-auto flex max-w-[820px] flex-col gap-6 p-8">
            <header>
                <h1 className="font-display text-[22px] font-semibold tracking-tight">
                    Account email prompt — every state
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                    Fixture for pixel verification. Not linked from anywhere and not indexed.
                </p>
            </header>

            <Case
                title="needs-email · /jobs banner"
                note="Signed in, no reachable address, prompted after two searches. Offers a way out."
            >
                <AccountEmailPrompt
                    state="needs-email"
                    pendingEmail={null}
                    onDismiss={() => {}}
                    className="border-t border-border pt-4 pb-2"
                />
            </Case>

            <Case
                title="needs-email · settings"
                note="Same component, no dismiss — settings has nowhere to dismiss to."
            >
                <AccountEmailPrompt state="needs-email" pendingEmail={null} />
            </Case>

            <Case
                title="pending-confirmation"
                note="Address submitted, link not yet clicked. Must NOT read as done — nothing has changed on the account yet."
            >
                <AccountEmailPrompt state="pending-confirmation" pendingEmail="person@example.com" />
            </Case>

            <Case
                title="reachable"
                note="Renders nothing at all. The dashed rule below should sit directly on the section's bottom padding."
            >
                <AccountEmailPrompt state="reachable" pendingEmail={null} />
            </Case>
        </main>
    );
}
