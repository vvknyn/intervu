/**
 * Primary nav — frozen coherent chrome:
 * Jobs · Resume · Tracker · Agents · (avatar → Account)
 * Research / Pricing / Trends live in the footer.
 */
import type { ComponentType } from "react";
import { FileText, Kanban } from "@phosphor-icons/react";

/**
 * Live counters a nav tab can carry. A tab DECLARES which counter it wants;
 * the nav bars resolve the number. Neither bar may test a tab's href or label
 * to decide whether to draw a badge — that would make "which tab has a count"
 * a fact spread across the two bars instead of one stated here, and the two
 * would drift the moment a second tab wanted one.
 */
export type NavBadge = "pursuits";

export type NavPlacement = "menu" | "bar";

export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
    placement: NavPlacement;
    tourSelector?: string;
    icon?: ComponentType;
    variant?: "cta";
    badge?: NavBadge;
};

/** Desktop TopBar: label for the clustered Jobs/Resume/Tracker dropdown. */
export function menuNavTriggerLabel(pathname: string, tabs: readonly NavTab[]): string {
    const active = tabs.find((t) => t.placement === "menu" && t.match(pathname));
    return active?.label ?? "Jobs";
}

export function menuNavActive(pathname: string, tabs: readonly NavTab[]): boolean {
    return tabs.some((t) => t.placement === "menu" && t.match(pathname));
}

function JobsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3-3" />
        </svg>
    );
}

/** G5f (Grok UX wave) — was three horizontal bars (decreasing width), which
 *  read as a hamburger/list icon rather than "tracked items". The Tracker
 *  board IS a status pipeline (interested/applied/interviewing/offer —
 *  lib/pursuits/types.ts's boardColumn), so Kanban (repo icon set,
 *  @phosphor-icons/react — already used throughout, e.g. JobDetail.tsx)
 *  reads correctly as that. */
function TrackerIcon() {
    return <Kanban aria-hidden />;
}

function ResumeIcon() {
    return <FileText aria-hidden />;
}

function ConnectIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="7" cy="12" r="3" />
            <circle cx="17" cy="12" r="3" />
            <path d="M10 12h4" />
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
        placement: "menu",
        icon: JobsIcon,
    },
    {
        label: "Resume",
        shortLabel: "Resume",
        href: "/resume",
        testId: "topbar-resume",
        match: (p) => p.startsWith("/resume"),
        placement: "menu",
        icon: ResumeIcon,
    },
    {
        label: "Tracker",
        shortLabel: "Tracker",
        href: "/yours",
        testId: "topbar-tracker",
        match: (p) => p.startsWith("/yours"),
        placement: "menu",
        icon: TrackerIcon,
        // The tracked count used to sit in the /jobs filter toolbar as a chip
        // linking here. It was never a filter — it narrowed nothing — so it
        // now rides on the destination it was already pointing at.
        badge: "pursuits",
    },
    {
        label: "Agents",
        shortLabel: "Agents",
        href: "/connect",
        testId: "topbar-connect",
        match: (p) => p.startsWith("/connect"),
        placement: "bar",
        tourSelector: "nav-connect",
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
    placement: "bar",
    icon: AccountIcon,
};

export const TRENDS_TAB: NavTab = {
    label: "Market trends",
    shortLabel: "Trends",
    href: "/trends",
    testId: "topbar-trends",
    match: (p) => p.startsWith("/trends"),
    placement: "bar",
};

export const FOOTER_EXTRA_TABS: NavTab[] = [
    {
        label: "Research",
        shortLabel: "Research",
        href: "/research/ghost-jobs",
        testId: "footer-research",
        match: (p) => p.startsWith("/research"),
        placement: "bar",
    },
    {
        label: "Pricing",
        shortLabel: "Pricing",
        href: "/pricing",
        testId: "footer-pricing",
        match: (p) => p.startsWith("/pricing"),
        placement: "bar",
    },
    TRENDS_TAB,
];
