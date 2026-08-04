"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Sun, Moon } from "@phosphor-icons/react";
import { onAuthChange, refreshSession, signOut, type User } from "@/lib/firebase/client-auth";
import { subscribeDark, getDarkSnapshot, getDarkServerSnapshot, toggleDark } from "@/lib/theme/dark-mode";
import { SecureStorage } from "@/lib/security";
import { AuthPopover } from "@/components/auth/auth-popover";
import { CreditBalance } from "@/components/layout/CreditBalance";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { Button } from "@/components/ui/button";

const BRAND_SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };

function initialsOf(user: User): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
}

/**
 * Secondary dropdown entries under the avatar (spec: "credits, Tracker,
 * Stories, Settings, Feedback, sign out"). Tracker lives here specifically
 * because it's signed-in-only — this dropdown only renders inside the
 * `user ? ... : ...` branch below — not because it moved out of a
 * top-level list; it isn't in `NAV_TABS` at all.
 */
const NAV_DESTINATIONS = [
    { label: "Tracker", href: "/yours" },
    { label: "Stories", href: "/stories" },
    { label: "Settings", href: "/settings" },
];

/**
 * The whole shell, post-flip: a wordmark, the four primary tabs, and an
 * auth-conditional avatar/login affordance. Replaces `AppShell` +
 * `AppShellWrapper` (deleted 6-item sidebar + mobile tab bar) — pure
 * inversion, no new nav concepts. Auth-state handling (session-cookie
 * refresh on first sign-in) is the same logic `AppShellWrapper` used to own.
 */
export function TopBar() {
    const pathname = usePathname();
    const [user, setUser] = useState<User | null>(null);
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const dark = useSyncExternalStore(subscribeDark, getDarkSnapshot, getDarkServerSnapshot);
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

    // "/" (the automation-first front door, src/app/page.tsx) renders its own
    // FrontDoorNav and owns the full page — it used to rely on being a
    // `fixed inset-0` layer to visually cover this header for free, but that
    // page is now a normal flowing document, so this header would otherwise
    // render as a second, redundant nav bar above it.
    const hideNav = pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) return null;

    // Same pattern as SettingsContainer's handleSignOut: clear locally-cached
    // secrets, sign out of Firebase (which also clears the session cookie),
    // then hard-navigate so every client store resets.
    const handleSignOut = async () => {
        SecureStorage.clear();
        await signOut();
        window.location.href = "/";
    };

    return (
        <header
            data-testid="topbar"
            // Squared design-system pass (docs-mockup.html "THE RULES" #2 —
            // "2px ink = primary structure": the masthead base is exactly
            // that, alongside the hero bar and a selected SERP card).
            className="shrink-0 border-b-2 border-foreground bg-card"
        >
            {/* Same shell as Find jobs SERP (max-w 1280 + px-4/8) so wordmark
                and search share one left edge — Soft Signal desktop grid. */}
            <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 px-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-6">
                {/* Reserved slot so nav doesn't jump while the brand morphs
                    from the empty-state hero into the masthead. */}
                <div className="flex h-[18px] min-w-[7.25rem] shrink-0 items-center">
                    <Link href="/" className="flex shrink-0 items-center gap-2.5">
                        <motion.span
                            layoutId="intervu-brand"
                            transition={BRAND_SPRING}
                            className="font-display text-[18px] font-extrabold leading-none tracking-tight"
                        >
                            intervu
                        </motion.span>
                        <motion.span
                            layoutId="intervu-beta"
                            transition={BRAND_SPRING}
                            className="rounded border border-border px-[5px] py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-faint"
                        >
                            beta
                        </motion.span>
                    </Link>
                </div>

                <nav
                    aria-label="Primary"
                    className="no-scrollbar hidden min-w-0 items-center gap-6 overflow-x-auto text-[13.5px] font-medium lg:flex"
                >
                    {NAV_TABS.map((tab) => {
                        if (tab.variant === "cta") {
                            return (
                                <Button asChild size="sm" key={tab.href} data-testid={tab.testId}>
                                    <Link href={tab.href}>{tab.label}</Link>
                                </Button>
                            );
                        }
                        const active = tab.match(pathname);
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                data-testid={tab.testId}
                                aria-current={active ? "page" : undefined}
                                // Active tab (docs-mockup.html Comp B): green
                                // inset underline, not ink — green is reserved
                                // for verified/live state (THE RULES #5), and
                                // "which surface you're on" is that kind of
                                // live-state signal, distinct from the ink
                                // masthead border it sits inside.
                                className={`shrink-0 whitespace-nowrap border-b-2 py-[18px] transition-colors duration-100 ${
                                    active
                                        ? "border-brand text-foreground font-bold"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {tab.label}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="flex shrink-0 items-center gap-4">
                <button
                    onClick={toggleDark}
                    data-testid="topbar-theme"
                    aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
                    title={dark ? "Switch to day mode" : "Switch to night mode"}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
                >
                    {dark ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
                </button>

                {user ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="topbar-avatar"
                                title={user.displayName || user.email || "Account"}
                                className="flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                            >
                                {/* Squared design-system pass (docs-mockup.html "THE RULES" #1 —
                                    pills retired app-wide): the avatar was the last rounded-full
                                    shape in the masthead. */}
                                <div className="grid h-8 w-8 shrink-0 place-items-center border border-green-tint-border bg-green-tint-bg font-mono text-xs font-bold text-brand">
                                    {initialsOf(user)}
                                </div>
                                <span className="text-[10px] text-muted-foreground">▾</span>
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
                            <DropdownMenuSeparator />
                            {/* preventDefault keeps the menu mounted while the
                                feedback dialog (whose Radix root lives inside
                                this content via FeedbackModal) is open —
                                closing the menu would unmount the dialog. */}
                            <FeedbackModal>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                                    Feedback
                                </DropdownMenuItem>
                            </FeedbackModal>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={handleSignOut}>Sign out</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <button
                        data-testid="topbar-login"
                        onClick={() => setAuthPopoverOpen(true)}
                        className="text-[13px] font-medium text-muted-foreground transition-colors duration-100 hover:text-foreground"
                    >
                        Log in
                    </button>
                )}
            </div>
            </div>

            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
        </header>
    );
}
