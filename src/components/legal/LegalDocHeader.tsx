import * as React from "react";
import { PageTitle } from "@/components/ui/heading";
import { DocWithToc } from "@/components/ui/on-this-page";
import { PageContainer } from "@/components/layout/PageContainer";

/**
 * Shared frame for the legal documents (/privacy, /terms): a centred ~68ch
 * reading column with no outer box, so the two pages can't drift apart.
 * `LegalDocFrame` adds the shared "On this page" list. `LegalDocHeader` is the
 * eyebrow, title and "Last updated" line. The body is the shared `Prose`
 * article wrapper. None of them touch the documents' wording.
 */
export function LegalDocFrame({ testId, children }: { testId: string; children: React.ReactNode }) {
    return (
        <PageContainer data-testid={testId} className="py-10">
            <DocWithToc>{children}</DocWithToc>
        </PageContainer>
    );
}

export function LegalDocHeader({ title, lastUpdated }: { title: string; lastUpdated: string }) {
    return (
        <div className="mb-8">
            <p className="text-xs font-semibold text-muted-foreground">Legal</p>
            <PageTitle className="mt-1">{title}</PageTitle>
            <p className="mono-data mt-3 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </div>
    );
}
