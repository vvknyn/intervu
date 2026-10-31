import Link from "next/link";
import { WaitBar, WaitState } from "@/components/ui/wait-state";

/**
 * The company page's wait skeleton, shown as the Suspense fallback of
 * `app/co/[slug]/page.tsx` while the page's data loads (`getCompanyPageData`
 * took 2.8-4.4s to first byte on prod, measured 2026-08-24). It is a
 * SKELETON, not a spinner, and mirrors the page's geometry block for block —
 * same breadcrumb row (minus the company-name bar), same `main` gutters, same
 * 56px logo square, same header split — so the swap to real content moves
 * nothing.
 *
 * It is NOT a route-level `loading.tsx`: that commits HTTP 200 before the
 * page can call `notFound()`, so an unknown slug became a soft 404. The page
 * checks existence first, then streams this.
 */
export function CompanyPageSkeleton() {
    return (
        <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
            {/* Real link, not a placeholder: it is the one control a waiting
                visitor might actually want, and it costs no data to render.
                Same bar as page.tsx (h-10, hairline bottom, 14px), so the
                breadcrumb doesn't change height or colour on arrival. */}
            <div className="border-b border-border">
                <nav className="shell-row flex h-10 items-center text-sm text-muted-foreground">
                    <Link href="/jobs" className="text-brand hover:underline">
                        Find jobs
                    </Link>
                </nav>
            </div>

            <WaitState
                label="Loading company page"
                skeleton={
                    <div className="shell-row page-top pb-12 sm:pb-16">
                        {/* Identity header — logo, name, the hiring answer, the
                            facts row, and the Follow control's slot on the right. */}
                        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 gap-5">
                                <WaitBar className="h-14 w-14 shrink-0 rounded-panel" />
                                <div className="min-w-0 flex-1 space-y-3 pt-1">
                                    <WaitBar className="h-8 w-55 max-w-full" />
                                    <WaitBar className="h-5 w-105 max-w-full" />
                                    <WaitBar className="h-4 w-80 max-w-full" />
                                </div>
                            </div>
                            <WaitBar className="h-10 w-50 shrink-0 self-start" />
                        </header>

                        {/* Same two columns as the page: stat row and role rows
                            on the left, the rail's sections on the right. */}
                        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                            <div className="min-w-0">
                                <div className="mb-8 flex flex-wrap gap-x-8 gap-y-4">
                                    {[0, 1, 2].map((stat) => (
                                        <div key={stat} className="space-y-1.5">
                                            <WaitBar className="h-7 w-16" />
                                            <WaitBar className="h-4 w-24" />
                                        </div>
                                    ))}
                                </div>
                                <WaitBar className="mb-4 h-7 w-40" />
                                <WaitBar className="mb-4 h-11 w-full rounded-ctl" />
                                {/* Flat rows with a hairline, like the real list. */}
                                {[0, 1, 2, 3].map((row) => (
                                    <div key={row} className="border-b border-border py-4">
                                        <WaitBar className="h-5 w-2/3" />
                                        <WaitBar className="mt-2 h-4 w-1/2" />
                                    </div>
                                ))}
                            </div>
                            <div className="space-y-8">
                                {[0, 1].map((section) => (
                                    <div key={section} className="border-t border-border pt-6">
                                        <WaitBar className="h-5 w-40" />
                                        <WaitBar className="mt-4 h-16 w-full" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                }
            />
        </div>
    );
}
