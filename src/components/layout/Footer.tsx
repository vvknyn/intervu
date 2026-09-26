"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "@phosphor-icons/react";
import { onAuthChange, type User } from "@/lib/firebase/client-auth";
import { FOOTER_EXTRA_TABS } from "@/components/layout/nav-tabs";
import { isLeanProductSurface, shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { useTheme } from "@/components/providers/ThemeProvider";
import { GHOST_RESEARCH_HREF, GHOST_SCREENING_CLAUSE } from "@/lib/marketing-stats";

/** Quiet footer links — Research lives here (not primary nav). `fromCurrentPage`
 *  marks a link whose destination wants to know where the visitor was —
 *  `FooterLinks` appends `?from=<pathname>` for any entry carrying it, keyed
 *  on the property itself rather than on which link this happens to be. */
export const LEGAL_LINKS: { label: string; href: string; fromCurrentPage?: true }[] = [
    { label: "Research", href: "/research/ghost-jobs" },
    { label: "About", href: "/about" },
    { label: "Remote jobs", href: "/careers/remote-jobs" },
    { label: "Company career pages", href: "/careers/company-career-pages" },
    { label: "Indeed alternative", href: "/indeed-alternative" },
    { label: "LinkedIn Jobs alternative", href: "/linkedin-jobs-alternative" },
    { label: "Eluta alternative", href: "/eluta-alternative" },
    { label: "Contact", href: "/contact" },
    { label: "Report a bug", href: "/contact?kind=bug", fromCurrentPage: true },
    { label: "Setup help", href: "/connect/help" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
];

/** Minimal legal strip for lean hub/deck/apply — not the marketing link farm. */
export const LEAN_LEGAL_LINKS: { label: string; href: string }[] = [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
];


/** Appends `from=<pathname>` to `href` for a link flagged `fromCurrentPage`,
 *  reusing whatever query string the link already has — pulled out of
 *  `FooterLinks` so the URL-building rule has one home instead of living
 *  inline in the render loop. */
function withFromParam(href: string, pathname: string): string {
    return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(pathname)}`;
}

/**
 * The compact link cluster on its own — reused by the global footer below,
 * and by the /jobs filter surfaces (`app/jobs/page.tsx`'s inline panel and
 * mobile sheet), which sit below or beside the infinite result feed where
 * the global `Footer` never scrolls into view. `children` lets a caller
 * (only `FooterContent` today) append something into the same `<nav>` —
 * used here for the dark-mode toggle so the global footer's DOM is
 * unchanged, not a mechanism for future filter-surface callers to grow.
 */
export function FooterLinks({ children }: { children?: React.ReactNode }) {
    const pathname = usePathname();
    return (
        <nav
            aria-label="Company"
            className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground"
        >
            {[...FOOTER_EXTRA_TABS.filter((t) => t.href === "/trends" || t.href === "/connect"), ...LEGAL_LINKS].map((link) => (
                <Link
                    key={link.href}
                    href={"fromCurrentPage" in link && link.fromCurrentPage ? withFromParam(link.href, pathname) : link.href}
                    className="transition-colors duration-100 hover:text-foreground"
                >
                    {link.label}
                </Link>
            ))}
            {children}
        </nav>
    );
}

/** Compact 1-line footer links — removed from filter panels; use `FooterContent`. */
export function FooterContent() {
    const [user, setUser] = useState<User | null>(null);
    const { mode, toggleMode, mounted } = useTheme();

    useEffect(() => {
        const unsubscribe = onAuthChange(setUser);
        return () => unsubscribe();
    }, []);

    return (
        <footer
            data-testid="site-footer"
            className="relative z-20 shrink-0 border-t border-border bg-background pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:pb-0"
        >
            {/* Same `shell-row` as TopBar — the two bands frame the page, so
                they have to share its gutter or the frame is crooked. */}
            <div className="shell-row flex flex-col gap-2 sm:gap-2.5 py-3 sm:py-4">
                <p className="max-w-md text-xs text-muted-foreground">
                    {/* Provenance without the geo clause from marketing-stats — avoids
                        the multi-country list on guest surfaces. */}
                    Every listing is from companies&apos; own career pages,{" "}
                    <Link href={GHOST_RESEARCH_HREF} className="underline underline-offset-2 hover:text-foreground">
                        {GHOST_SCREENING_CLAUSE}
                    </Link>
                    . Never resold, never curated.
                </p>
                <FooterLinks>
                    {!user && mounted && (
                        <button
                            type="button"
                            onClick={toggleMode}
                            aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
                            className="inline-flex items-center gap-1.5 transition-colors duration-100 hover:text-foreground"
                        >
                            {mode === "dark" ? <Sun /> : <Moon />}
                            <span>Dark mode {mode === "dark" ? "on" : "off"}</span>
                        </button>
                    )}
                </FooterLinks>
                <p className="max-w-md text-xs text-muted-foreground">
                    Job data by{" "}
                    <a
                        href="https://thesubspace.io"
                        target="_blank"
                        rel="noopener"
                        className="underline decoration-dotted underline-offset-2 transition-colors duration-100 hover:text-foreground"
                    >
                        Subspace
                    </a>
                </p>
            </div>
        </footer>
    );
}

/**
 * Quiet product band, mounted once in the root layout (same as `TopBar` and
 * `MobileTabBar`) rather than per-page, and visible on all viewports. Hides
 * on the same routes `TopBar` hides its own chrome on — a login/auth screen
 * shouldn't repeat the product nav. Landing (`/`) is full-bleed instrument —
 * chrome hidden via `shouldHideSiteChrome`.
 */
export function Footer() {
    const pathname = usePathname();
    if (shouldHideSiteChrome(pathname)) return null;
    if (isLeanProductSurface(pathname)) return <LeanFooterContent />;

    return <FooterContent />;
}

/** Privacy/Terms only — keeps legal reachable without the ~17-link farm on
 *  hub/deck/apply lean walks. */
function LeanFooterContent() {
    return (
        <footer
            data-testid="site-footer"
            data-lean="true"
            className="relative z-20 shrink-0 border-t border-border bg-background pb-[calc(var(--mobile-tabbar-h)+env(safe-area-inset-bottom,0px))] lg:pb-0"
        >
            <div className="shell-row flex flex-wrap items-center gap-x-5 gap-y-1.5 py-3 text-xs text-muted-foreground sm:py-4">
                {LEAN_LEGAL_LINKS.map((link) => (
                    <Link
                        key={link.href}
                        href={link.href}
                        className="transition-colors duration-100 hover:text-foreground"
                    >
                        {link.label}
                    </Link>
                ))}
            </div>
        </footer>
    );
}

