"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { onAuthChange, refreshSession, signOut, type User } from "@/lib/firebase/client-auth";
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

/** Jobs empty-ask sets `data-jobs-overlay-ask` so TopBar yields the brand to the hero morph. */
const OVERLAY_ASK_ATTR = "data-jobs-overlay-ask";
function subscribeOverlayAsk(onChange: () => void) {
    const obs = new MutationObserver(onChange);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: [OVERLAY_ASK_ATTR] });
    return () => obs.disconnect();
}
function getOverlayAskSnapshot(): boolean {
    return document.documentElement.getAttribute(OVERLAY_ASK_ATTR) === "1";
}
function getOverlayAskServerSnapshot(): boolean {
    return false;
}

const BRAND_SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };

// Dark mode ported from AppShell's footer toggle: same class-on-<html> flip,
// same "intervu-dark" persistence key (which layout.tsx's no-flash inline
// script reads before paint). Only the React wiring differs — AppShell read
// the class into state in a mount effect, which the react-hooks lint now
// rejects (set-state-in-effect); useSyncExternalStore is the equivalent
// hydration-safe shape: server snapshot false = what SSR renders, the client
// snapshot reads the real class, toggleDark writes then notifies.
const darkListeners = new Set<() => void>();
function subscribeDark(onChange: () => void) {
    darkListeners.add(onChange);
    return () => darkListeners.delete(onChange);
}
function getDarkSnapshot(): boolean {
    return document.documentElement.classList.contains("dark");
}
function getDarkServerSnapshot(): boolean {
    return false;
}
function toggleDark() {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    if (next) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
        localStorage.setItem("intervu-dark", next ? "1" : "0");
    } catch {
        /* ignore */
    }
    darkListeners.forEach((cb) => cb());
}

function initialsOf(user: User): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
}

/**
 * Secondary dropdown entries under the avatar (spec: "credits, Stories,
 * Settings, Feedback, sign out"). Prep/Resumes/Tracker moved out — they're
 * now top-level tabs in NAV_TABS, so keeping them here too would be a
 * redundant second path to the same three destinations.
 */
const NAV_DESTINATIONS = [
    { label: "Trends", href: "/trends" },
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
    const overlayAsk = useSyncExternalStore(
        subscribeOverlayAsk,
        getOverlayAskSnapshot,
        getOverlayAskServerSnapshot,
    );
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
            className="shrink-0 border-b border-border bg-card"
        >
            {/* Same shell as Find jobs SERP (max-w 1280 + px-4/8) so wordmark
                and search share one left edge — Soft Signal desktop grid. */}
            <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between gap-4 px-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-6">
                {/* Reserved slot so nav doesn't jump while the brand morphs
                    from the empty-state hero into the masthead. */}
                <div className="flex h-[18px] min-w-[7.25rem] shrink-0 items-center">
                    {!overlayAsk && (
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
                    )}
                </div>

                <nav
                    aria-label="Primary"
                    className="no-scrollbar hidden min-w-0 items-center gap-6 overflow-x-auto text-[13.5px] font-medium lg:flex"
                >
                    {NAV_TABS.map((tab) => {
                        const active = tab.match(pathname);
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                data-testid={tab.testId}
                                aria-current={active ? "page" : undefined}
                                className={`shrink-0 whitespace-nowrap border-b-2 py-[18px] transition-colors duration-100 ${
                                    active
                                        ? "border-foreground text-foreground"
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
                    className="font-mono text-[12px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
                >
                    {dark ? "day" : "night"}
                </button>

                {user ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                data-testid="topbar-avatar"
                                title={user.displayName || user.email || "Account"}
                                className="flex items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
                            >
                                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-green-tint-border bg-green-tint-bg font-mono text-xs font-bold text-brand">
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
