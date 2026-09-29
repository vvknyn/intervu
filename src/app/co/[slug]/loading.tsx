import Link from "next/link";
import { WaitBar, WaitState } from "@/components/ui/wait-state";

/**
 * Instant loading state for a company page.
 *
 * `page.tsx` is an async server component and `getCompanyPageData` takes
 * 2.8–4.4s to first byte on prod (measured 2026-08-24 across four slugs). Until
 * now nothing was rendered during that wait: the browser sat on the previous
 * page with no acknowledgement of the click, which reads as a frozen app
 * (Vivek: "the app feels like it is stuck"). Next wraps this file's default
 * export in a Suspense boundary around the route segment, so it paints the
 * moment the link is followed.
 *
 * It is a SKELETON, not a spinner, and it mirrors `page.tsx`'s geometry
 * block for block — same breadcrumb row (minus the company-name bar, so the
 * real link stays outside the wait ladder), same `main` gutters, same 56px logo
 * square, same header split. That is the point: the wait should read as "this
 * page is arriving, and it looks like this", and the swap to real content
 * shouldn't move anything. The same reasoning is already recorded on
 * `CompanyLogo`'s `md` size, which is pinned to the job-card skeleton's slot.
 *
 * Trade-off worth knowing: once a Suspense fallback renders, the response
 * headers are already sent, so an unknown slug can no longer answer 404 — it
 * answers 200 with `noindex` instead (Next's loading.js reference, "Status
 * Codes"). Search engines treat that as a soft 404 and don't index it; the
 * alternative is an existence check in `proxy` ahead of the boundary.
 */
export default function Loading() {
    return (
        <div className="min-h-[calc(100dvh-3.5rem)] bg-background">
            {/* Real link, not a placeholder: it is the one control a waiting
                visitor might actually want, and it costs no data to render. */}
            <div className="border-b border-border bg-card py-3">
                <nav className="shell-row text-xs text-muted-foreground">
                    <Link href="/jobs" className="text-brand hover:underline">
                        Find jobs
                    </Link>
                </nav>
            </div>

            <WaitState
                label="Loading company page"
                skeleton={
                    <div className="shell-row py-8 pb-12 sm:pb-16">
                        {/* Identity header — logo, name, one-liner, stage chip, and the
                            Follow control's slot on the right. */}
                        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 gap-5">
                                <WaitBar className="h-14 w-14 shrink-0 rounded-panel" />
                                <div className="min-w-0 flex-1 space-y-3 pt-1">
                                    {/* page.tsx's <h1> is text-2xl (24/32). */}
                                    <WaitBar className="h-8 w-55 max-w-full" />
                                    <WaitBar className="h-5 w-105 max-w-full" />
                                    <div className="flex gap-2 pt-1">
                                        <WaitBar className="h-6 w-24" />
                                        <WaitBar className="h-6 w-20" />
                                    </div>
                                </div>
                            </div>
                            <WaitBar className="h-10 w-50 shrink-0 self-start" />
                        </header>

                        {/* Open roles — the reason someone opened this page, so the
                            skeleton gives them the most room here too. */}
                        <div className="space-y-2.5">
                            <WaitBar className="mb-4 h-4 w-40" />
                            {[0, 1, 2, 3].map((row) => (
                                <div key={row} className="rounded-panel border border-border bg-surface px-5 py-4 shadow-[var(--shadow-bevel-highlight)]">
                                    <WaitBar className="h-5 w-2/3" />
                                    <div className="mt-2.5 flex gap-2">
                                        <WaitBar className="h-4 w-24" />
                                        <WaitBar className="h-4 w-16" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Quiet secondary block, matching the real page's `mt-10`. */}
                        <div className="mt-10 space-y-8">
                            <div className="rounded-panel bg-chip px-5 py-4">
                                <WaitBar className="h-4 w-28" />
                                <WaitBar className="mt-3 h-5 w-3/4" />
                                <WaitBar className="mt-2 h-4 w-1/2" />
                            </div>
                        </div>
                    </div>
                }
            />
        </div>
    );
}
