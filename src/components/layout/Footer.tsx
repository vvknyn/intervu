"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOOTER_EXTRA_TABS } from "@/components/layout/nav-tabs";
import { siteChrome } from "@/components/layout/site-chrome";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";
import { FOOTER_PROVENANCE_LINE } from "@/lib/marketing-stats";
import { cn } from "@/lib/utils";

/** Quiet footer links — Research/Pricing live here (not primary nav). */
const LEGAL_LINKS: { label: string; href: string }[] = [
    { label: "Research", href: "/research/ghost-jobs" },
    { label: "Pricing", href: "/pricing" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
];

/** The actual footer markup, mounted once by `Footer` below. */
export function FooterContent() {
    return (
        <footer
            data-testid="site-footer"
            className={cn("hidden shrink-0 border-t lg:block", siteChrome.bar, siteChrome.border)}
        >
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-3 px-5 py-6 sm:px-7">
                <p className={cn("max-w-md text-[12px]", siteChrome.faint)}>{FOOTER_PROVENANCE_LINE}</p>
                <nav
                    aria-label="Company"
                    className={cn("flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]", siteChrome.faint)}
                >
                    {[...FOOTER_EXTRA_TABS.filter((t) => t.href === "/trends"), ...LEGAL_LINKS].map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="transition-colors duration-100 hover:text-[#ececec]"
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
                        className="underline decoration-dotted underline-offset-2 hover:text-[#ececec]"
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
 * `MobileTabBar`) rather than per-page. Hides on the same routes `TopBar`
 * hides its own chrome on — a login/auth screen shouldn't repeat the product
 * nav. Landing (`/`) is full-bleed instrument — chrome hidden via
 * `shouldHideSiteChrome`.
 */
export function Footer() {
    const pathname = usePathname();
    const hideNav = shouldHideSiteChrome(pathname);
    if (hideNav) return null;

    return <FooterContent />;
}
