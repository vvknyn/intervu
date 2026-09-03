import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
    return (
        <main
            data-testid="company-truth-page"
            className="mx-auto max-w-3xl px-4 py-10 sm:px-6"
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">Loading company page</span>
            <div aria-hidden className="space-y-4">
                {/* CompanyHeader's <h1> is text-2xl (28/36) — matches its rendered line-height. */}
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-5 w-32" />
                <div className="mt-8 space-y-2.5 border-t border-border pt-6">
                    {[0, 1, 2].map((row) => (
                        <div key={row} className="border border-border bg-card px-5 py-4">
                            {/* CompanyRolesList row title is text-sm (14/20), meta is text-xs (12/16). */}
                            <Skeleton className="h-5 w-2/3" />
                            <Skeleton className="mt-2.5 h-4 w-1/3" />
                        </div>
                    ))}
                </div>
            </div>
        </main>
    );
}
