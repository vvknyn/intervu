import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
// Server-safe icon entry (`/dist/ssr`) — this page has no "use client"
// directive (it exports `generateMetadata`); see openclaw/page.tsx's own
// comment for why the default `@phosphor-icons/react` entry throws here.
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { getJobById } from "@/lib/jobs/get-job";
import { withDescriptionPlace } from "@/lib/jobs/place-notes";
import { reportShownJobs } from "@/lib/jobs/liveness-demand";
import { jobPath, parseJobSlug } from "@/lib/jobs/job-slug";
import { decodeText, displayCompanyBrand, locationText, titleCaseDisplay } from "@/lib/jobs/presentation";
import { canonicalMetadata, pageTitle } from "@/lib/seo/page-metadata";

/**
 * Server-rendered, shareable job page (spec 2026-08-09-shareable-job-pages); noindex by ruling.
 * Follows `src/app/co/[slug]/page.tsx` as the house pattern for a public
 * dynamic SEO route: async `params`, `notFound()`, `generateMetadata`.
 */
export const revalidate = 3600;

// `cache()` so generateMetadata and the page body share ONE fetch per
// request instead of hitting Meili twice for every crawler visit.
const load = cache(async (slug: string) => {
    const id = parseJobSlug(slug);
    if (!id) return null;
    const job = await getJobById(id);
    // The fit label reads the place the description limits the role to, as the lists do.
    return job ? { job: withDescriptionPlace(job), path: jobPath(job) } : null;
});

function displayCompanyFor(job: { company: string | null; company_domain: string | null; title: string }): string | null {
    const brand = displayCompanyBrand(job.company, job.company_domain, job.title);
    return brand || null;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const found = await load(slug);
    if (!found) notFound();

    const { job, path } = found;
    const company = displayCompanyFor(job);
    const where = locationText(job);
    const jobTitle = titleCaseDisplay(decodeText(job.title));
    const title = `${jobTitle}${company ? ` at ${company}` : ""}`;
    const description =
        job.company_opened_90d != null && job.company_closed_90d != null && company
            ? `${company} opened ${job.company_opened_90d} roles in 90 days and closed ${job.company_closed_90d}. See the hiring record before you apply.`
            : `${jobTitle}${company ? ` at ${company}` : ""} — checked against companies' own career pages.`;

    return {
        description,
        ...canonicalMetadata(path, pageTitle(title, where), description),
        robots: {
            index: false,
            follow: false,
            nocache: true,
            googleBot: {
                index: false,
                follow: false,
                noimageindex: true,
                "max-video-preview": -1,
                "max-image-preview": "none",
                "max-snippet": -1,
            },
        },
    };
}

export default async function JobPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const found = await load(slug);
    if (!found) notFound();

    const { job, path } = found;
    // Slug is decorative; if it drifted (a re-titled posting, a stale shared
    // link), send crawlers and humans to the one canonical URL.
    if (`/jobs/${slug}` !== path) permanentRedirect(path);
    // Buffer-only: a visited job page's link joins Subspace's liveness checks
    // (liveness-demand.ts dedupes repeat visits for 15 minutes).
    reportShownJobs([job]);

    return (
        <div data-testid="job-page" className="shell-row py-6">
            {/* Breadcrumb (spec annotation #1) — a cold visitor landing on a
                shared job link otherwise has no path into the board. Two
                segments only: back to /jobs, then the current job title as
                plain text — there is no sourced taxonomy field to put a third
                segment on, so none is invented. */}
            <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Link href="/jobs" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                    <ArrowLeft size={16} weight="bold" aria-hidden />
                    All jobs
                </Link>
                <span aria-hidden>/</span>
                <span className="truncate text-foreground">{titleCaseDisplay(decodeText(job.title))}</span>
            </nav>
            <PublicJobDetail job={job} layout="document" />
        </div>
    );
}
