"use client";

/**
 * Tracker / History switcher — sits atop both /yours and /yours/history.
 * Router-driven, not content-driven: each tab is its own route (not a
 * `TabsContent` panel), so this only ever renders the trigger row, reusing
 * the repo's one Tabs primitive (components/ui/tabs.tsx) rather than
 * inventing a second tab affordance.
 */

import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type TrackerTab = "tracker" | "history";

const ROUTE_FOR_TAB: Record<TrackerTab, string> = {
    tracker: "/yours",
    history: "/yours/history",
};

export function TrackerTabs({ active }: { active: TrackerTab }) {
    const router = useRouter();
    return (
        <Tabs
            value={active}
            onValueChange={(v) => {
                const tab = v as TrackerTab;
                if (tab !== active) router.push(ROUTE_FOR_TAB[tab]);
            }}
        >
            <TabsList variant="line">
                <TabsTrigger value="tracker">Tracker</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
        </Tabs>
    );
}
