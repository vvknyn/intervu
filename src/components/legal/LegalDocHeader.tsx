import { PageTitle } from "@/components/ui/heading";

/**
 * Shared header frame for the legal documents (/privacy, /terms) — the
 * eyebrow, title, and "Last updated" fact line. Both pages used to duplicate
 * this block with their own bracketed eyebrow and all-caps h1; this is the
 * one place that markup lives now; the two pages differ only in `title` and
 * `lastUpdated`, and neither page's body copy is touched by this component.
 */
export function LegalDocHeader({ title, lastUpdated }: { title: string; lastUpdated: string }) {
    return (
        <div className="mb-6">
            <p className="text-xs font-semibold text-muted-foreground">Legal</p>
            <PageTitle className="mt-1">{title}</PageTitle>
            <p className="mono-data mt-3 border-b border-border pb-4 text-sm text-muted-foreground">
                Last updated: {lastUpdated}
            </p>
        </div>
    );
}
