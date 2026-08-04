"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sun, Moon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { AuthPopover } from "@/components/auth/auth-popover";
import { NAV_TABS } from "@/components/layout/nav-tabs";
import { subscribeDark, getDarkSnapshot, getDarkServerSnapshot, toggleDark } from "@/lib/theme/dark-mode";
import { onAuthChange, type User } from "@/lib/firebase/client-auth";

const BRAND_SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.8 };

/**
 * The front door's own slim nav row — moved verbatim off the old `/`
 * hero (2026-08-03 one-viewport rebuild) when the SERP split out to
 * `/jobs`. Shares layoutIds (`intervu-brand`/`intervu-beta`) with
 * `TopBar`'s own brand purely as inert markers — `TopBar` hides entirely
 * on `/` (see its own `hideNav` check) since this page owns the full
 * route, so there's no morph to animate between them anymore.
 */
export function FrontDoorNav() {
    const [user, setUser] = useState<User | null>(null);
    const [authOpen, setAuthOpen] = useState(false);
    const dark = useSyncExternalStore(subscribeDark, getDarkSnapshot, getDarkServerSnapshot);

    useEffect(() => {
        const unsubscribe = onAuthChange(setUser);
        return () => unsubscribe();
    }, []);

    return (
        <header className="relative z-10 flex h-14 shrink-0 items-center justify-between px-4 lg:px-8">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
                <motion.span
                    layoutId="intervu-brand"
                    transition={BRAND_SPRING}
                    className="font-display text-[18px] font-extrabold leading-none tracking-tight text-white"
                >
                    intervu
                </motion.span>
                <motion.span
                    layoutId="intervu-beta"
                    transition={BRAND_SPRING}
                    className="rounded border border-white/25 px-[5px] py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-white/60"
                >
                    beta
                </motion.span>
            </Link>
            <nav aria-label="Primary" className="flex items-center gap-5">
                <div className="hidden items-center gap-5 text-[13.5px] font-medium text-white/70 sm:flex">
                    {NAV_TABS.filter((tab) => tab.href !== "/" && tab.variant !== "cta").map((tab) => (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className="transition-colors duration-100 hover:text-white"
                        >
                            {tab.label}
                        </Link>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={toggleDark}
                    // Distinct from TopBar's own `topbar-theme` — TopBar
                    // doesn't render on this route (see its `hideNav` check),
                    // but keeping a distinct testid avoids ambiguity with
                    // any future page that mounts both.
                    data-testid="hero-theme-toggle"
                    aria-label={dark ? "Switch to day mode" : "Switch to night mode"}
                    title={dark ? "Switch to day mode" : "Switch to night mode"}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-white/70 transition-colors duration-100 hover:bg-white/10 hover:text-white"
                >
                    {dark ? <Sun size={16} weight="bold" /> : <Moon size={16} weight="bold" />}
                </button>
                {!user && (
                    <button
                        type="button"
                        data-testid="landing-login"
                        onClick={() => setAuthOpen(true)}
                        className="hidden text-[13px] font-medium text-white/70 transition-colors duration-100 hover:text-white sm:inline"
                    >
                        Log in
                    </button>
                )}
                {NAV_TABS.filter((tab) => tab.variant === "cta").map((tab) => (
                    <Button asChild size="sm" variant="brand" key={tab.href} data-testid="hero-connect-cta">
                        <Link href={tab.href}>{tab.label}</Link>
                    </Button>
                ))}
            </nav>
            <AuthPopover open={authOpen} onOpenChange={setAuthOpen} showTrigger={false} />
        </header>
    );
}
