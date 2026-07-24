"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDown, Moon, SignIn, Sun } from "@phosphor-icons/react";
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
    { label: "Stories", href: "/stories" },
    { label: "Settings", href: "/settings" },
];

/**
 * The four always-visible top-level tabs (portal redesign spec — Tracker is
 * no longer gated on `hasPursuits`). `match` decides the active (ink text +
 * live-green underline) state from the current pathname; `testId` preserves
 * the pre-redesign `data-testid`s where one already existed on the
 * equivalent link (topbar-alljobs, topbar-yours).
 */
const NAV_TABS: { label: string; href: string; testId: string; match: (pathname: string) => boolean }[] = [
    { label: "Find jobs", href: "/", testId: "topbar-alljobs", match: (p) => p === "/" },
    { label: "Tracker", href: "/yours", testId: "topbar-yours", match: (p) => p.startsWith("/yours") },
    {
        label: "Resume",
        href: "/resume-builder",
        testId: "topbar-resume",
        match: (p) => p.startsWith("/resume-builder"),
    },
    { label: "Interview prep", href: "/prep", testId: "topbar-prep", match: (p) => p.startsWith("/prep") },
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
            className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 sm:px-6"
        >
            <div className="flex min-w-0 items-center gap-6 sm:gap-9">
                <Link href="/" className="flex shrink-0 items-baseline gap-2">
                    <span className="font-display text-[19px] font-medium leading-none tracking-[-0.02em] sm:text-[21px]">
                        inter<span className="font-bold">vu</span>
                    </span>
                    {/* The app's one BETA badge — see DashboardContainer.tsx's prep
                        title, which deliberately doesn't repeat it. */}
                    <span className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                        beta
                    </span>
                </Link>

                <nav
                    aria-label="Primary"
                    className="no-scrollbar flex min-w-0 items-center gap-5 overflow-x-auto text-[14.5px] font-medium sm:gap-6"
                >
                    {NAV_TABS.map((tab) => {
                        const active = tab.match(pathname);
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                data-testid={tab.testId}
                                aria-current={active ? "page" : undefined}
                                className={`shrink-0 whitespace-nowrap border-b-2 py-5 transition-colors ${
                                    active
                                        ? "border-live text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {tab.label}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="flex shrink-0 items-center gap-3">
                <button
                    onClick={toggleDark}
                    data-testid="topbar-theme"
                    title={dark ? "Switch to light mode" : "Switch to dark mode"}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    {dark ? <Sun size={17} className="shrink-0" /> : <Moon size={17} className="shrink-0" />}
                </button>

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
