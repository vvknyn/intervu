"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_TABS, TRENDS_TAB } from "@/components/layout/nav-tabs";
import { CORPUS_SOURCE_DESCRIPTOR } from "@/lib/marketing-stats";

/** Company/legal links — only the footer renders this row, so it lives here
 *  rather than in `nav-tabs.ts` (which is shared with `TopBar`/`MobileTabBar`). */
const LEGAL_LINKS: { label: string; href: string }[] = [
    { label: "About", href: "/about" },
    { label: "Pricing", href: "/pricing" },
    { label: "Research", href: "/research/ghost-jobs" },
    { label: "Contact", href: "/contact" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
];

/**
 * The actual footer markup, exported on its own so a page that mounts its
 * own instance — the automation-first front door (`src/app/page.tsx`) wraps
 * this in `.dark` inside its own scroll flow — can render it directly
 * without going through `Footer`'s route-based hide check below. That check
 * exists for the root layout's single shared mount; a page that
 * intentionally owns its own copy shouldn't be subject to a "hide on this
 * route" rule keyed on the very route it's rendering on.
 */
export function FooterContent() {
    return (
        <footer data-testid="site-footer" className="shrink-0 border-t border-border bg-card">
            <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center gap-3 px-4 py-6 text-center lg:px-8">
                <nav aria-label="Product" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] font-medium text-muted-foreground">
                    {[...NAV_TABS, TRENDS_TAB].map((tab) => (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className="transition-colors duration-100 hover:text-foreground"
                        >
                            {tab.label}
                        </Link>
                    ))}
                </nav>
                <p className="max-w-md text-[12px] text-faint">
                    Every listing is {CORPUS_SOURCE_DESCRIPTOR} — never resold, never curated.
                </p>
                <nav aria-label="Company" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[13px] font-medium text-muted-foreground">
                    {LEGAL_LINKS.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="transition-colors duration-100 hover:text-foreground"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>
                <p className="max-w-md text-[12px] text-faint">
                    Job data by{" "}
                    <a
                        href="https://thesubspace.io"
                        target="_blank"
                        rel="noopener"
                        className="underline decoration-dotted underline-offset-2 hover:text-foreground"
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
 * nav. Also hides on "/" (the automation-first front door), which mounts its
 * own `FooterContent` instance instead — see that component's doc comment.
 */
export function Footer() {
    const pathname = usePathname();
    const hideNav = pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) return null;

    return <FooterContent />;
}
