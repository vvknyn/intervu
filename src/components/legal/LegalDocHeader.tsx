import * as React from "react";
import { PageTitle } from "@/components/ui/heading";
import { DocWithToc } from "@/components/ui/on-this-page";
import { PageContainer } from "@/components/layout/PageContainer";
import { Prose } from "@/components/ui/prose";
import { cn } from "@/lib/utils";

/**
 * Shared frame for the legal documents (/privacy, /terms): a centred ~68ch
 * reading column with no outer box, so the two pages can't drift apart.
 * `LegalDocFrame` adds the shared "On this page" list. `LegalDocHeader` is the eyebrow, title and "Last updated" line;
 * `LegalProse` is the body at 16px / 1.625 with clear paragraph and list
 * spacing and more room above each h2 than below it. Neither touches the
 * documents' wording.
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

export function LegalProse({ className, ...props }: React.ComponentProps<typeof Prose>) {
    return (
        <Prose
            className={cn(
                "[&_li]:my-1.5 [&_li]:leading-relaxed [&_p]:my-4 [&_p]:leading-relaxed [&_ul]:my-4 [&_h2]:mb-3 [&_h2]:mt-12",
                className,
            )}
            {...props}
        />
    );
}
