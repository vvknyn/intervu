/**
 * Primary nav — frozen coherent chrome:
 * Jobs · Tracker · Connect · (avatar → Account)
 * Research / Pricing / Trends live in the footer.
 */
import type { ComponentType } from "react";

export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
    icon?: ComponentType;
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

function TrackerIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 6h16M4 12h10M4 18h13" />
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

function AccountIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
    );
}

export const NAV_TABS: NavTab[] = [
    {
        label: "Jobs",
        shortLabel: "Jobs",
        href: "/jobs",
        testId: "topbar-jobs",
        match: (p) => p === "/jobs" || p.startsWith("/jobs/"),
        icon: JobsIcon,
    },
    {
        label: "Tracker",
        shortLabel: "Tracker",
        href: "/yours",
        testId: "topbar-tracker",
        match: (p) => p.startsWith("/yours"),
        icon: TrackerIcon,
    },
    {
        label: "Connect",
        shortLabel: "Connect",
        href: "/connect",
        testId: "topbar-connect",
        // Landing is the agent instrument door (frozen mock).
        match: (p) => p === "/" || p.startsWith("/connect") || p.startsWith("/openclaw"),
        icon: ConnectIcon,
    },
];

/** Mobile-only: Account as fourth tab (desktop uses DP avatar). */
export const MOBILE_ACCOUNT_TAB: NavTab = {
    label: "Account",
    shortLabel: "Account",
    href: "/settings",
    testId: "topbar-account",
    match: (p) => p.startsWith("/settings") || p.startsWith("/account"),
    icon: AccountIcon,
};

export const TRENDS_TAB: NavTab = {
    label: "Market trends",
    shortLabel: "Trends",
    href: "/trends",
    testId: "topbar-trends",
    match: (p) => p.startsWith("/trends"),
};

export const FOOTER_EXTRA_TABS: NavTab[] = [
    {
        label: "Research",
        shortLabel: "Research",
        href: "/research/ghost-jobs",
        testId: "footer-research",
        match: (p) => p.startsWith("/research"),
    },
    {
        label: "Pricing",
        shortLabel: "Pricing",
        href: "/pricing",
        testId: "footer-pricing",
        match: (p) => p.startsWith("/pricing"),
    },
    TRENDS_TAB,
];
