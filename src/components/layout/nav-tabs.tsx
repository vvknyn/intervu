/**
 * Primary nav tabs (Jobs · Research · Pricing · Connect your AI). Companies
 * is temporarily removed — see the comment above `NAV_TABS` below.
 * Also drives the mobile tab bar (`MobileTabBar`), which renders one icon per
 * entry straight off this array's own `icon` field — a new tab is covered by
 * adding one entry here, not by also updating a second array kept in
 * lockstep by hand (the old `TAB_ICONS` positional array this replaced; see
 * PR #46 / P27 mobile pass). Market trends is footer-only chrome (see
 * `TRENDS_TAB` below) precisely so it doesn't have to grow this one.
 */
import type { ComponentType } from "react";

export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
    /** Rendered at 22×22 by MobileTabBar. Every `NAV_TABS` entry carries one;
     *  optional only because `TRENDS_TAB` (footer-only, never reaches the
     *  mobile tab bar) never needs one — left `undefined` there rather than
     *  borrowing an unrelated icon. */
    icon?: ComponentType;
    /** Set on the one entry every renderer (TopBar, Footer, MobileTabBar,
     *  the landing corner-links row) should render as an accent CTA button
     *  instead of a plain link — checked as a property, never by matching
     *  the label, so a future CTA tab needs no renderer changes. */
    variant?: "cta";
};

function JobsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
        </svg>
    );
}

function ResearchIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M3 20h18" />
            <path d="M6 20v-6M12 20V9M18 20v-9" />
        </svg>
    );
}

function PricingIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12.59 2.59a2 2 0 00-1.42-.59H4a2 2 0 00-2 2v7.17a2 2 0 00.59 1.42l9 9a2 2 0 002.82 0l7.17-7.17a2 2 0 000-2.82z" />
            <path d="M7 7h.01" />
        </svg>
    );
}

function ConnectIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M9 2v4M15 2v4" />
            <path d="M6 6h12v5a6 6 0 01-12 0z" />
            <path d="M12 17v5" />
        </svg>
    );
}

export const NAV_TABS: NavTab[] = [
    { label: "Jobs", shortLabel: "Jobs", href: "/", testId: "topbar-jobs", match: (p) => p === "/", icon: JobsIcon },
    // Companies (/companies/hiring) removed from nav 2026-08-02 — page is
    // redirected to /jobs until it can be served correctly, see
    // src/app/companies/hiring/page.tsx for why. Re-add the entry here when
    // that page is restored.
    {
        label: "Research",
        shortLabel: "Research",
        href: "/research/ghost-jobs",
        testId: "topbar-research",
        match: (p) => p.startsWith("/research"),
        icon: ResearchIcon,
    },
    {
        label: "Pricing",
        shortLabel: "Pricing",
        href: "/pricing",
        testId: "topbar-pricing",
        match: (p) => p.startsWith("/pricing"),
        icon: PricingIcon,
    },
    {
        label: "Connect your AI",
        shortLabel: "Connect",
        href: "/connect",
        testId: "topbar-connect",
        match: (p) => p.startsWith("/connect"),
        icon: ConnectIcon,
        variant: "cta",
    },
];

/**
 * Footer-only addition — never reaches `NAV_TABS`/`MobileTabBar` (same
 * reasoning this file already used for the old Market-trends entry), so no
 * icon needed.
 */
export const TRENDS_TAB: NavTab = {
    label: "Market trends",
    shortLabel: "Trends",
    href: "/trends",
    testId: "topbar-trends",
    match: (p) => p.startsWith("/trends"),
};
