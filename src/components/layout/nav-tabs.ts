/** Primary nav tabs (Find · Tracker · Resume · Prep). Trends lives in the avatar menu. */
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
