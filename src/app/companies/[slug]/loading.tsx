import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <div
            data-testid="company-truth-page"
            className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading company page</span>
            <div aria-hidden className="space-y-4">
                {/* CompanyHeader's <h1> is text-2xl (24/32) — matches its rendered line-height. */}
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-5 w-32" />
                {/* Mirrors CompanyRolesList's row anatomy: a grid row with a
                    full-width `border-b` divider (no per-row card box), title
                    + meta stacked left, a right-rail ghost on the right —
                    so loading → loaded doesn't shift anything. */}
                <div className="mt-8 border-t border-border pt-6">
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border pt-4 pb-4">
                            <div className="min-w-0 space-y-2">
                                <Skeleton className="h-5 w-2/3" />
                                <Skeleton className="h-4 w-1/3" />
                            </div>
                            <Skeleton className="h-3 w-12 self-start" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
