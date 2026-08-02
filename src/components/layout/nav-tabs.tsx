/**
 * Primary nav tabs (Find · Tracker · Resume · Prep). Also drives the mobile
 * tab bar (`MobileTabBar`), which renders one icon per entry straight off
 * this array's own `icon` field — a new tab is covered by adding one entry
 * here, not by also updating a second array kept in lockstep by hand (the
 * old `TAB_ICONS` positional array this replaced; see PR #46 / P27 mobile
 * pass). Market trends is desktop-only chrome (see `NAV_TABS_DESKTOP` below)
 * precisely so it doesn't have to grow this one.
 */
import type { ComponentType } from "react";

export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
    /** Rendered at 22×22 by MobileTabBar. Every `NAV_TABS` entry carries one;
     *  optional only because `NAV_TABS_DESKTOP`'s extra desktop-only entry
     *  (Market trends) never reaches the mobile tab bar and so never needs
     *  one — left `undefined` there rather than borrowing an unrelated icon. */
    icon?: ComponentType;
};

function FindIcon() {
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
            <rect x="3" y="4" width="5" height="16" rx="1" />
            <rect x="10" y="4" width="5" height="10" rx="1" />
            <rect x="17" y="4" width="5" height="13" rx="1" />
        </svg>
    );
}

function ResumeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    );
}

function PrepIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
        </svg>
    );
}

export const NAV_TABS: NavTab[] = [
    { label: "Find jobs", shortLabel: "Find", href: "/", testId: "topbar-alljobs", match: (p) => p === "/", icon: FindIcon },
    {
        label: "Tracker",
        shortLabel: "Tracker",
        href: "/yours",
        testId: "topbar-yours",
        match: (p) => p.startsWith("/yours"),
        icon: TrackerIcon,
    },
    {
        label: "Resume",
        shortLabel: "Resume",
        href: "/resume-builder",
        testId: "topbar-resume",
        match: (p) => p.startsWith("/resume-builder") || p.startsWith("/resume-tailor"),
        icon: ResumeIcon,
    },
    {
        label: "Interview prep",
        shortLabel: "Prep",
        href: "/prep",
        testId: "topbar-prep",
        match: (p) => p.startsWith("/prep"),
        icon: PrepIcon,
    },
];

/**
 * Desktop-only nav: `NAV_TABS` plus Market trends. Kept out of `NAV_TABS`
 * itself so the mobile tab bar's icon row never has to earn a 5th slot —
 * TopBar's wider desktop row has room for a 5th text link, so it (and the
 * footer, which shows the same product surface) render this combined list
 * instead. Single source for both.
 */
export const NAV_TABS_DESKTOP: NavTab[] = [
    ...NAV_TABS,
    { label: "Market trends", shortLabel: "Trends", href: "/trends", testId: "topbar-trends", match: (p) => p.startsWith("/trends") },
];
