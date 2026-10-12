"use client";

/**
 * Tracker / History switcher — sits atop both /yours and /yours/history.
 * Router-driven, not content-driven: each tab is its own route, so this is a
 * row of links (`TabNav` + `TabItem`, the repo's one tab look), not Radix
 * tabs. Radix triggers point `aria-controls` at a panel this page never
 * renders, which axe reports as a critical error (focus group, 2026-10-12).
 */

import Link from "next/link";
import { TabItem, TabNav, tabsListVariants } from "@/components/ui/tabs";

export type TrackerTab = "tracker" | "history";

const TABS: readonly { tab: TrackerTab; href: string; label: string }[] = [
    { tab: "tracker", href: "/yours", label: "Tracker" },
    { tab: "history", href: "/yours/history", label: "History" },
];

export function TrackerTabs({ active }: { active: TrackerTab }) {
    return (
        <TabNav aria-label="Tracker views" className={tabsListVariants({ variant: "line" })}>
            {TABS.map(({ tab, href, label }) => (
                <TabItem key={tab} asChild current={tab === active ? "page" : undefined}>
                    <Link href={href}>{label}</Link>
                </TabItem>
            ))}
        </TabNav>
    );
}
