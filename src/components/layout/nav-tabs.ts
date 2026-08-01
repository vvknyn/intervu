/**
 * Primary nav tabs (Find · Tracker · Resume · Prep). Also drives the mobile
 * tab bar (`MobileTabBar`), which renders one fixed icon per entry — its
 * `TAB_ICONS` array has exactly 4 icons, so this array's length must stay in
 * lockstep with it. Market trends is desktop-only chrome (see
 * `NAV_TABS_DESKTOP` below) precisely so it doesn't have to grow this one.
 */
export type NavTab = {
    label: string;
    shortLabel: string;
    href: string;
    testId: string;
    match: (pathname: string) => boolean;
};

export const NAV_TABS: NavTab[] = [
    { label: "Find jobs", shortLabel: "Find", href: "/", testId: "topbar-alljobs", match: (p) => p === "/" },
    { label: "Tracker", shortLabel: "Tracker", href: "/yours", testId: "topbar-yours", match: (p) => p.startsWith("/yours") },
    {
        label: "Resume",
        shortLabel: "Resume",
        href: "/resume-builder",
        testId: "topbar-resume",
        match: (p) => p.startsWith("/resume-builder") || p.startsWith("/resume-tailor"),
    },
    { label: "Interview prep", shortLabel: "Prep", href: "/prep", testId: "topbar-prep", match: (p) => p.startsWith("/prep") },
];

/**
 * Desktop-only nav: `NAV_TABS` plus Market trends. Kept out of `NAV_TABS`
 * itself so the mobile tab bar's fixed 4-icon layout never has to grow a 5th
 * slot — TopBar's wider desktop row has room for a 5th text link, so it (and
 * the footer, which shows the same product surface) render this combined
 * list instead. Single source for both.
 */
export const NAV_TABS_DESKTOP: NavTab[] = [
    ...NAV_TABS,
    { label: "Market trends", shortLabel: "Trends", href: "/trends", testId: "topbar-trends", match: (p) => p.startsWith("/trends") },
];
