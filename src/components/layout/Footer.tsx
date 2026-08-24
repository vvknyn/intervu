"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOOTER_EXTRA_TABS } from "@/components/layout/nav-tabs";
import { siteChrome } from "@/components/layout/site-chrome";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { FOOTER_PROVENANCE_LINE } from "@/lib/marketing-stats";
import { cn } from "@/lib/utils";

/** Quiet footer links — Research/Pricing live here (not primary nav). */
export const LEGAL_LINKS: { label: string; href: string }[] = [
    { label: "Research", href: "/research/ghost-jobs" },
    { label: "Pricing", href: "/pricing" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Setup help", href: "/connect/help" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
];

/** Compact 1-line footer links for embedding inside filter drawers and toolbars without chasing infinite scroll. */
export function CompactFooterLinks({ className }: { className?: string }) {
    return (
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground", className)}>
            {[...FOOTER_EXTRA_TABS.filter((t) => t.href === "/trends"), ...LEGAL_LINKS].map((link) => (
                <Link
                    key={link.href}
                    href={link.href}
                    className="transition-colors hover:text-foreground underline underline-offset-2"
                >
                    {link.label}
                </Link>
            ))}
            <span className="text-muted-foreground/60">· Job data by Subspace</span>
        </div>
    );
}

/** The actual footer markup, mounted once by `Footer` below. */
export function FooterContent() {
    return (
        <footer
            data-testid="site-footer"
            className={cn(
                "shrink-0 border-t pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0",
                siteChrome.bar,
                siteChrome.border,
            )}
        >
            {/* Same edge-to-edge treatment as TopBar — the two bands frame the
                page, so they have to share its gutter or the frame is crooked. */}
            <div className="flex w-full flex-col gap-3 px-4 py-6 sm:px-8 xl:px-10">
                <p className={cn("max-w-md text-[12px]", siteChrome.faint)}>{FOOTER_PROVENANCE_LINE}</p>
                <nav
                    aria-label="Company"
                    className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]", siteChrome.faint)}
                >
                    {[...FOOTER_EXTRA_TABS.filter((t) => t.href === "/trends"), ...LEGAL_LINKS].map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className={cn("transition-colors duration-100", siteChrome.faintHover)}
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>
                <p className={cn("max-w-md text-[12px]", siteChrome.faint)}>
                    Job data by{" "}
                    <a
                        href="https://thesubspace.io"
                        target="_blank"
                        rel="noopener"
                        className={cn("underline decoration-dotted underline-offset-2", siteChrome.faintHover)}
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
 *
 * Suppressed on infinite-scroll routes (`/jobs`) so the footer never runs away
 * or jumps when the list sentinel auto-loads more results. Secondary links
 * live in the filter panel, top nav, and settings on those surfaces.
 */
export function Footer() {
    const pathname = usePathname();
    const hideNav = shouldHideSiteChrome(pathname);
    const isInfiniteScroll = pathname === "/jobs" || pathname.startsWith("/jobs/");
    if (hideNav || isInfiniteScroll) return null;

    return <FooterContent />;
}

