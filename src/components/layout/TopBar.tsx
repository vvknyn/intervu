"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDown, SignIn } from "@phosphor-icons/react";
import { onAuthChange, refreshSession, type User } from "@/lib/firebase/client-auth";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CreditBalance } from "@/components/layout/CreditBalance";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The brand mark — the V of inter·vu, cut as a rising checkmark. Carries the accent. */
function VMark({ size = 26 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="intervu" className="shrink-0">
            <path
                d="M9 13 L19 28 L31 7"
                fill="none"
                stroke="rgb(var(--brand))"
                strokeWidth={4.4}
                strokeLinecap="square"
                strokeLinejoin="miter"
            />
        </svg>
    );
}

function initialsOf(user: User): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
}

/** Destinations that lived in the old sidebar — now dropdown entries under the avatar. */
const NAV_DESTINATIONS = [
    { label: "Prep", href: "/prep" },
    { label: "Resumes", href: "/resume-builder" },
    { label: "Applications", href: "/applications" },
    { label: "Library", href: "/library" },
    { label: "Settings", href: "/settings" },
];

/**
 * The whole shell, post-flip: a wordmark, one link back to the jobs root,
 * and an auth-conditional avatar/login affordance. Replaces `AppShell` +
 * `AppShellWrapper` (deleted 6-item sidebar + mobile tab bar) — pure
 * inversion, no new nav concepts. Auth-state handling (session-cookie
 * refresh on first sign-in) is the same logic `AppShellWrapper` used to own.
 */
export function TopBar() {
    const pathname = usePathname();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const sessionRefreshed = useRef(false);

    useEffect(() => {
        const unsubscribe = onAuthChange((u) => {
            setUser(u);
            // The httpOnly session cookie expires after 14 days while the
            // client SDK keeps the user signed in indefinitely — server
            // actions then see a logged-in user as anonymous (AUTH_REQUIRED).
            // Re-mint the cookie from the fresh ID token once per app load.
            if (u && !sessionRefreshed.current) {
                sessionRefreshed.current = true;
                refreshSession().catch(() => {
                    // Offline or transient failure — the next page load retries.
                });
            }
        });
        return () => unsubscribe();
    }, []);

    const hideNav = pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) return null;

    return (
        <header
            data-testid="topbar"
            className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 sm:px-6"
        >
            <Link href="/" className="flex items-center gap-2">
                <VMark size={26} />
                <span className="text-[17px] font-bold tracking-[-0.4px] leading-none">
                    inter<b className="text-brand font-bold">vu</b>
                </span>
                {/* The app's one BETA badge — see DashboardContainer.tsx's prep
                    title, which deliberately doesn't repeat it. */}
                <span className="self-start mt-1 text-[8.5px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground/80">
                    beta
                </span>
            </Link>

            <div className="flex items-center gap-4">
                <Link
                    href="/"
                    data-testid="topbar-alljobs"
                    className="text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                    All jobs
                </Link>

                {user ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="topbar-avatar"
                                title={user.displayName || user.email || "Account"}
                                className="flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                            >
                                <div
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-brand-foreground"
                                    style={{
                                        background: "linear-gradient(135deg, rgb(var(--brand) / 0.85), rgb(var(--brand)))",
                                    }}
                                >
                                    {initialsOf(user)}
                                </div>
                                <CaretDown size={14} className="text-muted-foreground" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <div className="px-2 py-1.5">
                                <CreditBalance />
                            </div>
                            <DropdownMenuSeparator />
                            {NAV_DESTINATIONS.map((item) => (
                                <DropdownMenuItem key={item.href} asChild>
                                    <Link href={item.href}>{item.label}</Link>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <button
                        data-testid="topbar-login"
                        onClick={() => setAuthPopoverOpen(true)}
                        className="flex items-center gap-1 text-[13.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <SignIn size={16} className="shrink-0" />
                        Log in
                    </button>
                )}
            </div>

            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
        </header>
    );
}
