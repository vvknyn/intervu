import * as React from "react";
import { PageEyebrow, PageTitle } from "@/components/ui/heading";
import { DocWithToc } from "@/components/ui/on-this-page";
import { PageContainer } from "@/components/layout/PageContainer";

/**
 * Shared frame for the legal documents (/privacy, /terms): a 28rem reading
 * column (~66 chars of body text) on the page's left edge with no outer box,
 * so the two pages can't drift apart.
 * `LegalDocFrame` adds the shared "On this page" list. `LegalDocHeader` is the
 * eyebrow, title and "Last updated" line. The body is the shared `Prose`
 * article wrapper. None of them touch the documents' wording.
 */
export function LegalDocFrame({ testId, header, children }: { testId: string; header: React.ReactNode; children: React.ReactNode }) {
    // The masthead comes first on every width; the "On this page" list follows
    // it (a rail beside the body on desktop, a <details> under it on a phone).
    return (
        <PageContainer data-testid={testId} className="page-top pb-10">
            {header}
            <DocWithToc>{children}</DocWithToc>
        </PageContainer>
    );
}

export function LegalDocHeader({ title, lastUpdated }: { title: string; lastUpdated: string }) {
    return (
        <div className="mb-8">
            <PageEyebrow>Legal</PageEyebrow>
            <PageTitle>{title}</PageTitle>
            <p className="mono-data mt-3 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </div>
    );
}
