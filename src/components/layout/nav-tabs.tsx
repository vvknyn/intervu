/**
 * Primary nav — frozen coherent chrome:
 * Jobs · Résumé · Tracker · Account on mobile bar
 * Research / Trends live in the footer.
 */
import type { ComponentType } from "react";
import { FileText, Kanban, MagnifyingGlass, UserCircle } from "@phosphor-icons/react";

export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
    tourSelector?: string;
    icon?: ComponentType;
    variant?: "cta";
    title?: string;
    /** Set `false` to keep a tab out of MobileTabBar's fixed bottom bar while
     *  it stays in the desktop nav — the bar filters on this field alone
     *  (never on href/label), so a new tab is on the bar by default and has
     *  to opt out explicitly. Omitted/`true` means "show on the bar". */
    mobilePrimary?: boolean;
};

/** MobileTabBar's own filter, pulled out so it's one pure decision testable
 *  without rendering the bar: `mobilePrimary: false` opts a tab out, every
 *  other tab (field unset or `true`) stays in — matches the desktop bar's
 *  `NAV_TABS`/`barTabs` unfiltered by this field, so only THIS predicate
 *  ever decides mobile-bar membership. */
export function mobilePrimaryTabs(tabs: readonly NavTab[]): NavTab[] {
    return tabs.filter((t) => t.mobilePrimary !== false);
}

/** `tab.icon` is only ever rendered by MobileTabBar (TopBar's desktop nav
 *  draws labels, not icons) at the one place the design language allows a
 *  20px icon instead of the 16px default — so each wrapper below hardcodes
 *  `size={20}` itself rather than threading a size prop through a call site
 *  that doesn't exist. */
function JobsIcon() {
    return <MagnifyingGlass size={20} aria-hidden />;
}

/** G5f (Grok UX wave) — was three horizontal bars (decreasing width), which
 *  read as a hamburger/list icon rather than "tracked items". The Tracker
 *  board IS a status pipeline (interested/applied/interviewing/offer —
 *  lib/pursuits/types.ts's boardColumn), so Kanban (repo icon set,
 *  @phosphor-icons/react — already used throughout, e.g. JobDetail.tsx)
 *  reads correctly as that. */
function TrackerIcon() {
    return <Kanban size={20} aria-hidden />;
}

function ResumeIcon() {
    return <FileText size={20} aria-hidden />;
}

function AccountIcon() {
    return <UserCircle size={20} aria-hidden />;
}

/** Résumé nav label — "Add résumé" until connected, then "Résumé". */
export function resumeTabLabel(resumeConnected: boolean): string {
    return resumeConnected ? "Résumé" : "Add résumé";
}

/** The ONE résumé entry in the nav: /resume (the AI pairing at /connect lives in Settings). */
export const RESUME_TAB: NavTab = {
    label: "Add résumé",
    shortLabel: "Add résumé",
    href: "/resume",
    testId: "topbar-resume",
    match: (p) => p.startsWith("/resume"),
    tourSelector: "nav-connect",
    icon: ResumeIcon,
};

export const NAV_TABS: NavTab[] = [
    {
        label: "Jobs",
        shortLabel: "Jobs",
        href: "/jobs",
        testId: "topbar-jobs",
        match: (p) => p === "/jobs" || p.startsWith("/jobs/"),
        icon: JobsIcon,
    },
    RESUME_TAB,
    {
        label: "Tracker",
        shortLabel: "Tracker",
        href: "/yours",
        testId: "topbar-tracker",
        match: (p) => p.startsWith("/yours"),
        icon: TrackerIcon,
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
    TRENDS_TAB,
];
