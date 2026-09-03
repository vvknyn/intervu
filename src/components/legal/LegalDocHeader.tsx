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
            <h1 className="mt-1 text-3xl font-semibold text-foreground">{title}</h1>
            <p className="mono-data mt-3 border-b border-border pb-4 text-sm text-muted-foreground">
                Last updated: {lastUpdated}
            </p>
        </div>
    );
}

// Section headings for /privacy and /terms (rulebook: "sections 20/28 600") —
// exported alongside the header component so both legal pages share one
// definition instead of each hand-rolling the same className string.
export const LEGAL_H2 = "mt-8 mb-3 text-xl font-semibold text-foreground";
