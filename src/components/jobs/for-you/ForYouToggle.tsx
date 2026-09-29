"use client";

import { TabItem, TabNav } from "@/components/ui/tabs";
import type { JobsHomeView } from "@/lib/jobs/for-you/home-view";

export interface ForYouToggleProps {
    value: JobsHomeView;
    onChange: (view: JobsHomeView) => void;
    className?: string;
}

const VIEWS = [
    { view: "for-you", label: "For you", testId: "jobs-home-for-you" },
    { view: "search", label: "Search", testId: "jobs-home-search" },
] as const;

/**
 * Header-row view switch: For you (personalized packs) ↔ Search. Two views of
 * one page, not two panels — so a labelled nav with `aria-current`, not a
 * `tablist` (which would owe every tab a controlled `tabpanel`).
 */
export function ForYouToggle({ value, onChange, className }: ForYouToggleProps) {
    return (
        <TabNav aria-label="For you or Search" data-testid="jobs-home-toggle" className={className}>
            {VIEWS.map(({ view, label, testId }) => (
                <TabItem
                    key={view}
                    size="bar"
                    current={value === view}
                    data-testid={testId}
                    onClick={() => onChange(view)}
                >
                    {label}
                </TabItem>
            ))}
        </TabNav>
    );
}
