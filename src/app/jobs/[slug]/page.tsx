import { cache } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { EmployerTrackRecord } from "@/components/jobs/EmployerTrackRecord";
import { PublicJobDetail } from "@/components/jobs/PublicJobDetail";
import { getJobById } from "@/lib/jobs/get-job";
import { jobPath, parseJobSlug } from "@/lib/jobs/job-slug";
import { locationText, titleCaseDisplay } from "@/lib/jobs/presentation";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

/**
 * Server-rendered, indexable job page (spec 2026-08-09-shareable-job-pages).
 * Follows `src/app/co/[slug]/page.tsx` as the house pattern for a public
 * dynamic SEO route: async `params`, `notFound()`, `generateMetadata`,
 * JSON-LD injected via a raw `<script>` tag.
 */
export const revalidate = 3600;

// `cache()` so generateMetadata and the page body share ONE fetch per
// request instead of hitting Meili twice for every crawler visit.
const load = cache(async (slug: string) => {
    const id = parseJobSlug(slug);
    if (!id) return null;
    const job = await getJobById(id);
    return job ? { job, path: jobPath(job) } : null;
});

function displayCompanyFor(job: { company: string | null }): string | null {
    return job.company ? titleCaseDisplay(job.company) : null;
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string }>;
}): Promise<Metadata> {
    const { slug } = await params;
    const found = await load(slug);
    if (!found) return { title: "Job not found", robots: { index: false, follow: false } };

    const { job, path } = found;
    const company = displayCompanyFor(job);
    const where = titleCaseDisplay(locationText(job));
    const title = `${job.title}${company ? ` at ${company}` : ""}${where ? ` — ${where}` : ""} | Intervu`;
    const description =
        job.company_opened_90d != null && job.company_closed_90d != null && company
            ? `${company} opened ${job.company_opened_90d} roles in 90 days and closed ${job.company_closed_90d}. See the hiring record before you apply.`
            : `${job.title}${company ? ` at ${company}` : ""} — checked against companies' own career pages.`;

    return {
        title,
        description,
        ...canonicalMetadata(path, title, description),
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

    const closed = job.vacancy_status === "closed";

    return (
        <main data-testid="job-page" className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
            {closed && (
                <p data-testid="job-closed-notice" className="mt-2 text-sm text-muted-foreground">
                    This role is closed. It was last seen active on{" "}
                    {job.updated_at ? new Date(job.updated_at).toISOString().slice(0, 10) : "an earlier date"}.
                </p>
            )}
            <EmployerTrackRecord job={job} />
            <PublicJobDetail job={job} />
        </main>
    );
}
