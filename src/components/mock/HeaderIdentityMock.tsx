"use client";

import Link from "next/link";
import { BrandLockup } from "@/components/brand/BrandMark";
import { AccountMenu } from "@/components/layout/AccountMenu";
import type { User } from "@/lib/firebase/client-auth";
import { PageTitle } from "@/components/ui/heading";

/**
 * Three signed-in identities, real `BrandLockup`/`AccountMenu` components —
 * not `<TopBar />` itself, because `shouldHideSiteChrome` self-hides TopBar
 * on every `/mock/*` route (same reason `ConsentCards.tsx` reuses
 * `BrandLockup` directly instead of rendering TopBar under `/oauth`).
 */
const FIXTURES: { title: string; user: User }[] = [
    {
        title: "Google photo",
        user: { uid: "mock-1", displayName: "Vivek Narayanan", email: "vivek@example.com", pictureUrl: "/velai-logo.png" },
    },
    {
        title: "No photo — name initials",
        user: { uid: "mock-2", displayName: "Vivek Narayanan", email: "vivek@example.com" },
    },
    {
        title: "No photo, no name — email initials",
        user: { uid: "mock-3", email: "priya@example.com" },
    },
];

/** One 48px header bar at true scale — the mark/wordmark lockup left,
 *  the account trigger right, same layout TopBar's own row uses. */
function HeaderStrip({ user }: { user: User }) {
    return (
        <div className="flex h-[var(--topbar-h)] items-center justify-between border-b border-border bg-background px-4">
            <Link href="#" className="flex shrink-0 items-center gap-2" data-rulebook-exempt>
                <BrandLockup markClassName="h-8 w-8" />
            </Link>
            <AccountMenu
                user={user}
                active={false}
                signingOut={false}
                onSignOut={() => {}}
            />
        </div>
    );
}

export function HeaderIdentityMock() {
    return (
        <main className="shell-row flex flex-col gap-6 py-8">
            <header>
                <PageTitle>Signed-in header identity</PageTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                    Avatar trigger (photo / initials / email-initials) + 32px brand mark. Compare-only fixture, not
                    linked from anywhere and not indexed.
                </p>
            </header>

            {FIXTURES.map(({ title, user }) => (
                <section key={user.uid} className="border border-border bg-card" data-testid={`header-identity-${user.uid}`}>
                    <h2 className="border-b border-dashed border-border px-4 py-2 text-xs font-semibold text-muted-foreground">
                        {title}
                    </h2>
                    <HeaderStrip user={user} />
                </section>
            ))}
        </main>
    );
}
