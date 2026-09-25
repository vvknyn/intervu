"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Buildings, MapPin, CircleNotch } from "@phosphor-icons/react";
import { getDefaultBrowseAction } from "@/actions/jobs";
import type { PublicJob } from "@/lib/jobs/types";
import { displayCompanyBrand, locationText, salaryText } from "@/lib/jobs/presentation";
import { jobPath } from "@/lib/jobs/job-slug";
import { cn } from "@/lib/utils";
import {
    Card as IconiqCard,
    CardContent as IconiqCardContent,
    ICONIQ_VELAI_THEME,
    ICONIQ_VELAI_PANEL,
} from "@/components/ui/iconiq";

const PREVIEW_LIMIT = 9;

type PreviewState =
    | { status: "loading" }
    | { status: "ready"; jobs: PublicJob[] }
    | { status: "empty" }
    | { status: "error" };

/**
 * Public landing strip: real Meili/default-browse roles before auth.
 * Matching / Strong-Good fit / packs stay behind sign-in + résumé.
 */
export function LandingLiveRolesPreview({
    onBrowseMore,
    className,
}: {
    /** Soft-gate into Advanced search (public SERP) — not the For-you packs deck. */
    onBrowseMore?: () => void;
    className?: string;
}) {
    const [state, setState] = useState<PreviewState>({ status: "loading" });

    useEffect(() => {
        let mounted = true;
        void (async () => {
            try {
                // Geo-aware cached browse (same public path as Advanced search at rest).
                const result = await getDefaultBrowseAction(false);
                if (!mounted) return;
                if (result.unavailable) {
                    setState({ status: "error" });
                    return;
                }
                const hits = result.hits ?? [];
                // Prefer postings that already disclose pay — still real Meili hits only.
                const withPay = hits.filter(
                    (j) => j.salary_min != null || j.salary_max != null,
                );
                const withoutPay = hits.filter(
                    (j) => j.salary_min == null && j.salary_max == null,
                );
                const jobs = [...withPay, ...withoutPay].slice(0, PREVIEW_LIMIT);
                setState(jobs.length > 0 ? { status: "ready", jobs } : { status: "empty" });
            } catch {
                if (mounted) setState({ status: "error" });
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <div className={cn("space-y-2", className)} data-testid="landing-live-roles">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="h-1.5 w-1.5 rounded-pill bg-live" />
                    <span className="font-semibold text-foreground">Live roles</span>
                    <span className="text-muted-foreground">· straight from employers</span>
                </div>
                {onBrowseMore ? (
                    <button
                        type="button"
                        onClick={onBrowseMore}
                        className="text-xs font-semibold text-brand hover:underline shrink-0"
                        data-testid="landing-browse-more-roles"
                    >
                        Browse more →
                    </button>
                ) : null}
            </div>

            {state.status === "loading" ? (
                <div className="flex items-center justify-center gap-2 rounded-panel border border-border bg-muted/40 px-3 py-8 text-xs text-muted-foreground">
                    <CircleNotch size={16} className="animate-spin text-brand" />
                    Loading live roles…
                </div>
            ) : null}

            {state.status === "error" ? (
                <div
                    className="rounded-panel border border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground text-center"
                    data-testid="landing-live-roles-error"
                >
                    Live roles are temporarily unavailable. You can still start private matching —
                    or try again in a moment.
                </div>
            ) : null}

            {state.status === "empty" ? (
                <div
                    className="rounded-panel border border-border bg-muted/40 px-3 py-4 text-xs text-muted-foreground text-center"
                    data-testid="landing-live-roles-empty"
                >
                    No live roles to preview right now. Start private matching to continue, or
                    browse again shortly.
                </div>
            ) : null}

            {state.status === "ready" ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {state.jobs.map((job) => {
                        const company = displayCompanyBrand(job.company, job.company_domain, job.title) || job.company || "Employer";
                        const place = locationText(job);
                        const pay = salaryText(job);
                        return (
                            <li key={job.id}>
                                <IconiqCard
                                    asChild
                                    interactive
                                    className={cn(
                                        ICONIQ_VELAI_THEME,
                                        ICONIQ_VELAI_PANEL,
                                        "h-full border border-border bg-card shadow-none",
                                    )}
                                >
                                    <Link
                                        href={jobPath(job)}
                                        className="block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                    >
                                        <IconiqCardContent className="p-2.5 sm:p-3 space-y-1.5">
                                            <div className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
                                                {job.title}
                                            </div>
                                            <div className="flex items-start gap-1 text-xs text-muted-foreground">
                                                <Buildings size={12} className="mt-0.5 shrink-0 text-brand" />
                                                <span className="truncate">{company}</span>
                                            </div>
                                            <div className="flex items-start gap-1 text-xs text-muted-foreground">
                                                <MapPin size={12} className="mt-0.5 shrink-0" />
                                                <span className="line-clamp-1">{place}</span>
                                            </div>
                                            {pay ? (
                                                <div className="text-xs font-semibold text-foreground pt-0.5">
                                                    {pay}
                                                </div>
                                            ) : null}
                                        </IconiqCardContent>
                                    </Link>
                                </IconiqCard>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
