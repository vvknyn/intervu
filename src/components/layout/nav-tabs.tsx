/**
 * Primary nav — frozen coherent chrome:
 * Jobs · Resume · Tracker · Connect AI · (avatar → Account)
 * Research / Trends live in the footer.
 */
import type { ComponentType } from "react";
import { FileText, Kanban, MagnifyingGlass, PlugsConnected, UserCircle } from "@phosphor-icons/react";

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
    title?: string;
    /** Set `false` to keep a tab out of MobileTabBar's fixed bottom bar while
     *  it stays in the desktop nav — the bar filters on this field alone
     *  (never on href/label), so a new tab is on the bar by default and has
     *  to opt out explicitly. Omitted/`true` means "show on the bar". */
    mobilePrimary?: boolean;
};

/** Desktop TopBar: label for the clustered Jobs/Resume/Tracker dropdown. */
export function menuNavTriggerLabel(pathname: string, tabs: readonly NavTab[]): string {
    const active = tabs.find((t) => t.placement === "menu" && t.match(pathname));
    return active?.label ?? "Jobs";
}

export function menuNavActive(pathname: string, tabs: readonly NavTab[]): boolean {
    return tabs.some((t) => t.placement === "menu" && t.match(pathname));
}

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

function ConnectIcon() {
    return <PlugsConnected size={20} aria-hidden />;
}

function AccountIcon() {
    return <UserCircle size={20} aria-hidden />;
}

/** The MCP/agent-pairing tab — named so the footer can link the SAME entry
 *  (label, href, icon) rather than re-typing "Connect AI"/"/connect" as a
 *  second copy, the way `TRENDS_TAB` below is shared with FOOTER_EXTRA_TABS.
 *  `mobilePrimary: false` keeps it off MobileTabBar's fixed bottom bar (a
 *  pairing flow isn't a top-5 daily action on a phone); it stays reachable
 *  from the footer and from Settings (AgentAccessSection.tsx already links
 *  `/connect`), and desktop's `barTabs` still renders it every time. */
export const CONNECT_TAB: NavTab = {
    label: "Connect AI",
    shortLabel: "Connect AI",
    href: "/connect",
    testId: "topbar-connect",
    match: (p) => p.startsWith("/connect"),
    placement: "bar",
    tourSelector: "nav-connect",
    icon: ConnectIcon,
    title: "Optional: Pair your AI assistant (Claude, Cursor, Gemini) via MCP",
    mobilePrimary: false,
};

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
    CONNECT_TAB,
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
    TRENDS_TAB,
    CONNECT_TAB,
];
